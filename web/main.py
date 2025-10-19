# web/main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from PIL import Image
import pytesseract
import uuid, os, json, re

import os
os.environ.setdefault("TESSDATA_PREFIX", "/usr/share/tesseract-ocr/4.00/tessdata")


# ======================== TESSERACT AYARI ========================
if os.name == "nt":
    tpath = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if Path(tpath).exists():
        pytesseract.pytesseract.tesseract_cmd = tpath

# ========================== DİZİN YAPISI =========================
BASE_DIR    = Path(__file__).resolve().parent
STATIC_DIR  = BASE_DIR / "static"
RUNTIME_DIR = BASE_DIR / "runtime"
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="KolayFatura Web")

# Statik dosyalar
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# =========================================================
# ----------------- BASİT AUTH / KULLANICI ----------------
# =========================================================
USERS_FILE  = BASE_DIR / "users.json"
COOKIE_NAME = "kf_user"

def load_users() -> dict:
    if not USERS_FILE.exists():
        return {}
    return json.loads(USERS_FILE.read_text(encoding="utf-8"))

def save_users(data: dict):
    USERS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def check_password(username: str, password: str) -> Optional[dict]:
    users = load_users()
    u = users.get(username)
    if not u:
        return None
    if u.get("password") != password:
        return None
    exp = u.get("expires_at")
    if exp:
        try:
            if date.today() > datetime.strptime(exp, "%Y-%m-%d").date():
                return None
        except Exception:
            pass
    return u  # {"password":..., "role":"admin"/"user", "expires_at":...}

def current_user_obj(request: Request) -> Optional[dict]:
    username = request.cookies.get(COOKIE_NAME)
    if not username:
        return None
    u = load_users().get(username)
    if not u:
        return None
    return {"username": username, **u}

def require_user(request: Request) -> dict:
    u = current_user_obj(request)
    if not u:
        raise HTTPException(status_code=401, detail="Yetkisiz")
    return u

def require_admin(request: Request) -> dict:
    u = require_user(request)
    if u.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Yönetici yetkisi gerekir")
    return u

# =========================================================
# ----------------------- SAYFALAR ------------------------
# =========================================================
@app.get("/login")
def login_page():
    return FileResponse(STATIC_DIR / "login.html")

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    u = current_user_obj(request)
    if not u:
        return RedirectResponse(url="/login")
    if u.get("role") == "admin":
        return RedirectResponse(url="/admin")
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/admin")
def admin_page(request: Request):
    require_admin(request)
    return FileResponse(STATIC_DIR / "admin.html")

# =========================================================
# ----------------------- AUTH API ------------------------
# =========================================================
@app.get("/api/me")
def api_me(request: Request):
    u = current_user_obj(request)
    if not u:
        raise HTTPException(status_code=401, detail="Not logged in")
    return {"username": u["username"], "role": u.get("role", "user")}

@app.post("/api/login")
async def api_login(username: str = Form(...), password: str = Form(...)):
    u = check_password(username, password)
    if not u:
        return JSONResponse({"ok": False, "error": "Kullanıcı adı/şifre geçersiz ya da süresi dolmuş"}, status_code=401)
    target = "/admin" if u.get("role") == "admin" else "/"
    resp = JSONResponse({"ok": True, "redirect": target})
    # Dev/prod güvenliği: dev'de secure=False, prod'da True
    resp.set_cookie(
        key=COOKIE_NAME,
        value=username,
        httponly=True,
        secure=os.getenv("ENV", "dev") != "dev",
        samesite="lax",
        path="/",
        max_age=60*60*8  # 8 saat
    )
    return resp

@app.post("/api/logout")
async def api_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME, path="/")
    return resp

# -------------------- Admin kullanıcı API ----------------
@app.get("/api/users")
def list_users(request: Request):
    require_admin(request)
    data = load_users()
    sanitized = {u: {"role": d.get("role"), "expires_at": d.get("expires_at")} for u, d in data.items()}
    return {"ok": True, "users": sanitized}

@app.post("/api/users/upsert")
async def upsert_user(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    role: str = Form("user"),
    expires_at: str = Form(None)
):
    require_admin(request)
    users = load_users()
    users[username] = {"password": password, "role": role, "expires_at": expires_at or None}
    save_users(users)
    return {"ok": True}

@app.post("/api/users/delete")
async def delete_user(request: Request, username: str = Form(...)):
    require_admin(request)
    users = load_users()
    if username in users:
        del users[username]
        save_users(users)
    return {"ok": True}

# =========================================================
# ----------------- OCR PARSING / YARDIMCI ----------------
# =========================================================
ALLOWED_IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
MAX_BYTES       = 7 * 1024 * 1024  # 7 MB

NUM_TRY    = re.compile(r'(?:₺|TL|TRY)?\s*([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:\.[0-9]{2}))')
DATE_RX    = re.compile(r'\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b')
DATE_RX2   = re.compile(r'\b(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}|\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}|\d{1,2}\s+\w{3,}\s+\d{4})\b', re.IGNORECASE)
PERCENT_RX = re.compile(r'(%\s*\d{1,2})|(\d{1,2}\s*%)')

MONTH_MAP_TR = {
    "OCA": 1, "OCAK": 1, "ŞUB": 2, "SUB": 2, "ŞUBAT": 2, "SUBAT": 2,
    "MAR": 3, "MART": 3, "NİS": 4, "NIS": 4, "NİSAN": 4, "NISAN": 4,
    "MAY": 5, "MAYIS": 5, "HAZ": 6, "HAZİRAN": 6, "HAZIRAN": 6,
    "TEM": 7, "TEMMUZ": 7, "AĞU": 8, "AGU": 8, "AĞUSTOS": 8, "AGUSTOS": 8,
    "EYL": 9, "EYLÜL": 9, "EYLUL": 9,
    "EKİ": 10, "EKI": 10, "EKİM": 10, "EKIM": 10,
    "KAS": 11, "KASIM": 11,
    "ARA": 12, "ARALIK": 12
}

def _validate_upload(upload: UploadFile):
    ext = Path(upload.filename).suffix.lower()
    if ext not in ALLOWED_IMG_EXT:
        raise HTTPException(status_code=415, detail="Yalnızca JPG/PNG/BMP/TIFF desteklenir.")
    if not (upload.content_type or "").startswith(("image/", "application/octet-stream")):
        raise HTTPException(status_code=415, detail="Geçersiz içerik türü.")

def parse_amount(txt: str) -> Decimal | None:
    m = NUM_TRY.search((txt or "").replace('\xa0',' ').strip())
    if not m:
        return None
    s = m.group(1)
    if ',' in s and '.' in s:
        s = s.replace('.', '').replace(',', '.')
    elif ',' in s:
        s = s.replace(',', '.')
    try:
        return Decimal(s)
    except InvalidOperation:
        return None

def find_first_date(lines: list[str]) -> str | None:
    for ln in lines:
        m = DATE_RX.search(ln) or DATE_RX2.search(ln)
        if not m:
            continue
        raw = re.sub(r'\s+', ' ', m.group(1)).strip()

        # Ay isimleriyle (Oca/Şub/...) gelen formatı destekle
        parts = raw.replace('.', ' ').replace('/', ' ').replace('-', ' ').split()
        if len(parts) == 3 and not parts[0].isdigit() and parts[1].isdigit():
            # Örn: "Oca 12 2025" gibi – nadir, atla
            pass

        # "12 Oca 2025" gibi
        if len(parts) == 3 and parts[0].isdigit() and not parts[1].isdigit() and parts[2].isdigit():
            d = int(parts[0])
            mo_name = parts[1].upper()
            y = int(parts[2])
            mo = MONTH_MAP_TR.get(mo_name, None)
            if mo:
                return f"{y:04d}-{mo:02d}-{d:02d}"

        # Standart ayraçlı formatlar
        try:
            sep = '.' if '.' in raw else ('/' if '/' in raw else '-')
            segs = raw.split(sep)
            if len(segs[0]) == 4:
                y, mo, d = segs
            else:
                d, mo, y = segs
            if len(y) == 2:
                y = '20' + y
            return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
        except Exception:
            return raw
    return None

def find_receipt_no(text: str, lines: list[str]) -> str | None:
    m = re.search(r'F[İI]Ş\s*NO\s*[:#]?\s*([A-Z]?\s?\d{1,8})', text, re.IGNORECASE)
    if m:
        return m.group(1).replace(' ', '')
    for ln in lines:
        mm = re.search(r'(FATURA|BELGE|EVRAK)\s*NO\s*[:#]?\s*([A-Z]?\s?\d{3,})', ln, re.IGNORECASE)
        if mm:
            return mm.group(2).replace(' ', '')
    return None

def find_vat_rate(text: str, lines: list[str]) -> str | None:
    m = re.search(r'KDV\s*[Xx%]?\s*([0-9]{1,2}(?:[.,]\d{1,2})?)', text, re.IGNORECASE)
    if m:
        return m.group(1).replace(',', '.')
    for ln in lines:
        mm = PERCENT_RX.search(ln)
        if mm:
            return (mm.group(1) or mm.group(2)).replace('%', '').replace(' ', '')
    return None

def find_numbers(lines: list[str]) -> dict:
    lower = [ln.lower() for ln in lines]
    subtotal = vat_total = total = None
    NO_TOTAL_HINTS = ['para üstü', 'paraustu', 'para ustu', 'iade', 'yuvarlama', 'round', 'fis iptali', 'üstü']

    # total
    for i in range(len(lines)-1, -1, -1):
        l = lower[i]; ln = lines[i]
        if ('genel toplam' in l or 'geneltoplam' in l) and not any(h in l for h in NO_TOTAL_HINTS):
            amt = parse_amount(ln)
            if amt is not None:
                total = amt
                break
    if total is None:
        for i in range(len(lines)-1, -1, -1):
            l = lower[i]; ln = lines[i]
            if ('toplam' in l) and not any(k in l for k in ['topkdv','kdv toplam']) and not any(h in l for h in NO_TOTAL_HINTS):
                amt = parse_amount(ln)
                if amt is not None:
                    total = amt
                    break

    # vat_total
    for i in range(len(lines)-1, -1, -1):
        l = lower[i]; ln = lines[i]
        if any(k in l for k in ['topkdv','top kdv','kdv toplam','hesaplanan kdv','kdv tutar']):
            amt = parse_amount(ln)
            if amt is not None:
                vat_total = amt
                break

    # subtotal
    SUB_KEYS = ['ara toplam','ara top','aratop','aratoplam','ara tplm','aratplm','mal hizmet','mal/hizmet']
    for i in range(len(lines)-1, -1, -1):
        l = lower[i]; ln = lines[i]
        if any(k in l for k in SUB_KEYS):
            amt = parse_amount(ln)
            if amt is not None:
                subtotal = amt
                break

    return {
        "subtotal": str(subtotal) if subtotal is not None else None,
        "vat_total": str(vat_total) if vat_total is not None else None,
        "total":    str(total)    if total    is not None else None,
    }

def guess_payment(lines: list[str], text: str) -> str | None:
    low_lines = [ln.lower() for ln in lines]

    # TOPLAM satırını bul
    total_idx = None
    for i in range(len(low_lines) - 1, -1, -1):
        if 'toplam' in low_lines[i]:
            total_idx = i
            break

    def is_cash(s: str) -> bool:
        return re.search(r'\bnak[ıi]t\b', s) is not None or re.search(r'\bnak[ıi]?\b', s) is not None

    def is_card(s: str) -> bool:
        return re.search(r'(kred[ıi]\s*kart[ıi]|banka\s*kart[ıi]|visa|master|amex|troy|pos|temass|kk\b|kart\b)', s) is not None

    # Yemek kartları & taksit
    all_low = (text or "").lower()
    if re.search(r'\b(multinet|metropol|sodexo|setcard|ticket|yemekmatik)\b', all_low):
        return 'Yemek Kartı'
    if re.search(r'\btaksit|taks\.\b', all_low):
        return 'Kredi Kartı (Taksit)'

    # 1) TOPLAM çevresi (üst/alt)
    if total_idx is not None:
        start = max(0, total_idx - 4)
        end   = min(len(low_lines), total_idx + 5)
        window = low_lines[start:end]
        for s in window:
            if is_cash(s):
                return 'Nakit'
            if is_card(s):
                return 'Kredi Kartı'

    # 2) Tüm metin (fallback)
    if is_cash(all_low):
        return 'Nakit'
    if is_card(all_low):
        return 'Kredi Kartı'

    # 3) kısa ipuçları (satır bazlı)
    for s in low_lines:
        if re.search(r'\bnakit\b', s) and re.search(r'\d', s):
            return 'Nakit'
        if re.search(r'\b(k\.?k\.?|kk|kart)\b', s) and re.search(r'\d', s):
            return 'Kredi Kartı'

    return None

def _to_tsv_grid(text: str):
    """Satırları hücrelere böl (sekme/çoklu boşluk/| ile)."""
    rows = []
    for raw in (text or "").splitlines():
        if not raw.strip():
            continue
        line = re.sub(r'[|]', ' ', raw)
        parts = re.split(r'\s{2,}|\t', line.strip())
        rows.append([p.strip() for p in parts if p.strip()])
    return rows

def _find_neighbor_value(grid, label_variants):
    """
    1) Aynı hücrede ':' sonrası
    2) Aynı satır sağ hücre
    3) Alt satır ilk hücre
    """
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            up = cell.upper().replace(':', ' ')
            if any(lab in up for lab in label_variants):
                m = re.search(r':\s*([A-Z0-9\-\/]{2,})', cell, re.IGNORECASE)
                if m:
                    return m.group(1).strip(), 0.9
                if c + 1 < len(row):
                    val = row[c + 1]
                    if val and len(val) >= 2:
                        return val.strip(), 0.95
                if r + 1 < len(grid) and grid[r + 1]:
                    val = grid[r + 1][0]
                    if val and len(val) >= 2:
                        return val.strip(), 0.75
    return None, 0.0

def find_vendor(lines: list[str]) -> str | None:
    header = lines[:30]  # daha geniş aralık
    cand = []
    for ln in header:
        l = ln.strip()
        ll = l.lower()
        if len(l) < 3:
            continue
        if any(w in ll for w in [
            'a.ş', 'a.s', 'ltd', 'şti', 'sti', 'tic', 'san',
            'market', 'mağaza', 'magaza', 'migros', 'bim', 'a101', 'şok', 'sok',
            'ünvan', 'unvan', 'ünvanı', 'unvani'
        ]):
            cand.append(l)
    if cand:
        return ' '.join(cand) if len(cand) > 1 else cand[0]
    for ln in header:
        if len(ln.strip()) >= 3 and not (DATE_RX.search(ln) or DATE_RX2.search(ln)):
            return ln.strip()
    return None

def parse_receipt_text(text: str) -> dict:
    # OCR karakter temizliği
    text = (text or "").replace('“','').replace('”','').replace('«','').replace('»','').replace('—','-')
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Regex tabanlı ilk çıkarım
    date_str  = find_first_date(lines)
    rno       = find_receipt_no(text, lines)
    nums      = find_numbers(lines)
    vat_rate  = find_vat_rate(text, lines)
    payment   = guess_payment(lines, text)
    vendor    = find_vendor(lines)

    # Komşu hücre (grid) ile iyileştirme
    grid = _to_tsv_grid(text)

    # Fiş No
    receipt_conf = 0.7 if rno else 0.0
    if not rno:
        rno2, rc = _find_neighbor_value(grid, [
            "FİŞ NO","FIS NO","FATURA NO","BELGE NO","EVRAK NO","DOCUMENT NO","INVOICE NO","SLIP NO"
        ])
        if rno2:
            rno, receipt_conf = rno2, max(receipt_conf, rc)

    # Ara Toplam
    sub_conf = 0.8 if nums["subtotal"] else 0.0
    if not nums["subtotal"]:
        sub2, sc = _find_neighbor_value(grid, ["ARA TOPLAM","ARATOP","ARATOPLAM","MAL HİZMET","MAL/HİZMET"])
        if sub2:
            val = parse_amount(sub2)
            nums["subtotal"] = str(val) if val is not None else sub2
            sub_conf = max(sub_conf, sc if val is not None else 0.6)

    # KDV Toplam
    vat_conf = 0.8 if nums["vat_total"] else 0.0
    if not nums["vat_total"]:
        vat2, vc = _find_neighbor_value(grid, ["KDV TOPLAM","TOPKDV","TOP KDV","HESAPLANAN KDV","KDV TUTAR"])
        if vat2:
            val = parse_amount(vat2)
            nums["vat_total"] = str(val) if val is not None else vat2
            vat_conf = max(vat_conf, vc if val is not None else 0.6)

    # Genel Toplam
    tot_conf = 0.9 if nums["total"] else 0.0
    if not nums["total"]:
        tot2, tc = _find_neighbor_value(grid, ["GENEL TOPLAM","TOPLAM TUTAR","TOPLAM"])
        if tot2:
            val = parse_amount(tot2)
            nums["total"] = str(val) if val is not None else tot2
            tot_conf = max(tot_conf, tc if val is not None else 0.7)

    # Ödeme tipi (komşuluk ipucu ek destek)
    pay_conf = 0.6 if payment else 0.0
    if not payment:
        pay2, pc = _find_neighbor_value(grid, ["ÖDEME","ODEME","TUTAR","TOPLAM"])
        if pay2 and re.search(r'\bnak[ıi]t\b', pay2.lower()):
            payment, pay_conf = "Nakit", max(pay_conf, pc, 0.8)
        elif pay2 and re.search(r'(kred[ıi]\s*kart[ıi]|banka\s*kart[ıi]|visa|master|troy|pos|temass|kk\b|kart\b)', pay2.lower()):
            payment, pay_conf = "Kredi Kartı", max(pay_conf, pc, 0.8)

    # Basit güven skorları
    vat_rate_conf = 0.8 if vat_rate else 0.0
    date_conf     = 0.85 if date_str else 0.0
    vendor_conf   = 0.8 if vendor else 0.0

    conf = {
        "vendor":       vendor_conf,
        "date":         date_conf,
        "receipt_no":   receipt_conf,
        "subtotal":     sub_conf,
        "vat_total":    vat_conf,
        "total":        tot_conf,
        "vat_rate":     vat_rate_conf,
        "payment_type": pay_conf,
    }

    return {
        "vendor":       vendor,
        "date":         date_str,
        "receipt_no":   rno,
        "subtotal":     nums["subtotal"],
        "vat_total":    nums["vat_total"],
        "total":        nums["total"],
        "vat_rate":     vat_rate,        # '18' → %18
        "payment_type": payment,
        "conf":         conf
    }

# =========================================================
# --------------------- OCR İŞLEME ------------------------
# =========================================================
def _open_image_to_ocr(path: Path):
    # Gri ton + basit eşikleme (Otsu benzeri)
    img = Image.open(path).convert("L")
    try:
        thresh = img.point(lambda p: 255 if p > 180 else 0)
        return thresh
    except Exception:
        return img

def _ocr_with_fallback(img, lang: str):
    tries = [
        (lang, "--psm 6"),
        ("tur", "--psm 6"),
        ("tur+eng", "--psm 4"),
        ("eng", "--psm 6"),
    ]
    last_err = None
    for ln, cfg in tries:
        try:
            txt = pytesseract.image_to_string(img, lang=ln, config=cfg)
            txt = "\n".join(t.strip() for t in txt.splitlines() if t.strip())
            if len(txt) >= 5:
                return txt
        except Exception as e:
            last_err = e
    raise HTTPException(status_code=500, detail=f"OCR başarısız: {last_err}")

# =========================================================
# ----------------------- OCR API -------------------------
# =========================================================
@app.post("/api/ocr")
async def ocr_endpoint(
    request: Request,
    file: UploadFile = File(...),
    kategori: str = Form("Market"),
    lang: str = Form("tur+eng"),
):
    require_user(request)

    _validate_upload(file)
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Dosya çok büyük.")

    workdir = RUNTIME_DIR / uuid.uuid4().hex
    workdir.mkdir(parents=True, exist_ok=True)
    raw_path = workdir / file.filename
    raw_path.write_bytes(data)

    try:
        img = _open_image_to_ocr(raw_path)
        text = _ocr_with_fallback(img, lang=lang)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR hatası: {e}")

    parsed = parse_receipt_text(text)
    u = current_user_obj(request)

    return JSONResponse({
        "status": "ok",
        "user": (u["username"] if u else None),
        "kategori": kategori,
        "ocr_preview": text[:12000],
        "length": len(text),
        "parsed": parsed,
    })

# =========================================================
# -------------------- TOPLU OCR API ----------------------
# =========================================================
@app.post("/api/ocr-batch")
async def ocr_batch(
    request: Request,
    files: List[UploadFile] = File(...),
    kategori: str = Form("Market"),
    lang: str = Form("tur+eng"),
):
    require_user(request)

    results = []
    for f in files:
        try:
            _validate_upload(f)
        except HTTPException as e:
            results.append({
                "filename": f.filename,
                "status": "error",
                "detail": e.detail
            })
            continue

        blob = await f.read()
        if len(blob) > MAX_BYTES:
            results.append({
                "filename": f.filename,
                "status": "error",
                "detail": "Dosya çok büyük."
            })
            continue

        workdir = RUNTIME_DIR / uuid.uuid4().hex
        workdir.mkdir(parents=True, exist_ok=True)
        raw_path = workdir / f.filename
        raw_path.write_bytes(blob)

        try:
            img = _open_image_to_ocr(raw_path)
            text = _ocr_with_fallback(img, lang=lang)
            parsed = parse_receipt_text(text)
            results.append({
                "filename": f.filename,
                "status": "ok",
                "kategori": kategori,
                "ocr_preview": text[:4000],
                "parsed": parsed
            })
        except Exception as e:
            results.append({
                "filename": f.filename,
                "status": "error",
                "detail": f"{e}"
            })

    return JSONResponse({"ok": True, "items": results})
