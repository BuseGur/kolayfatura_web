// /static/login.js — tek akış, çifte submit yok
(function () {
  'use strict';

  const form = document.getElementById('loginForm');
  const err  = document.getElementById('err');
  const user = document.getElementById('username');
  const pass = document.getElementById('password');
  const capsHint = document.getElementById('capsHint');
  const userHint = document.getElementById('userHint');
  const toggle = document.getElementById('togglePass');
  const btn  = form?.querySelector('button[type="submit"]');

  // Son kullanılan kullanıcı adını hatırla (isteğe bağlı)
  try {
    const last = localStorage.getItem('kf_last_user');
    if (last && user && !user.value) user.value = last;
  } catch {}

  // Parola görünürlüğü
  toggle?.addEventListener('click', () => {
    if (!pass) return;
    const isPwd = pass.type === 'password';
    pass.type = isPwd ? 'text' : 'password';
    toggle.textContent = isPwd ? '🙈' : '👁️';
  });

  // Caps Lock uyarısı
  function updateCaps(e){
    if (!capsHint) return;
    if (e.getModifierState && e.getModifierState('CapsLock')) {
      capsHint.textContent = 'Caps Lock açık görünüyor.';
    } else {
      capsHint.textContent = '';
    }
  }
  pass?.addEventListener('keydown', updateCaps);
  pass?.addEventListener('keyup',   updateCaps);

  // Kullanıcı adı ipucu
  user?.addEventListener('input', () => {
    if (!userHint) return;
    userHint.textContent = user.value ? '' : 'Örn: demo1, demo2...';
  });

  // Ağ isteği yardımcıları
  async function loginRequest(fd){
    const r = await fetch('/api/login', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      cache: 'no-store'
    });
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok || data?.ok === false) {
      const msg = (data && (data.detail || data.error)) || `Giriş başarısız (HTTP ${r.status})`;
      const e = new Error(msg);
      e.status = r.status;
      throw e;
    }
    return data;
  }

  // Submit handler (tek)
  async function onSubmit(e){
    e.preventDefault();
    if (!form) return;
    if (err) { err.style.display = 'none'; err.textContent = ''; }

    if (!form.checkValidity()) {
      if (err) { err.textContent = 'Lütfen gerekli alanları doldurun.'; err.style.display = 'block'; }
      return;
    }

    // Çifte tıklamayı engelle
    if (btn) { btn.disabled = true; btn.dataset.loading = '1'; }

    try {
      const fd = new FormData(form);
      const data = await loginRequest(fd);

      // Başarı
      try { localStorage.setItem('kf_last_user', (user?.value || '').trim()); } catch {}
      const target = data.redirect || '/';
      // Tarihçeyi kirletmeden yönlendir
      location.replace(target);
    } catch (ex) {
      if (err) {
        err.textContent = ex?.message || 'Ağ/istemci hatası';
        err.style.display = 'block';
        // küçük sarsma animasyonu (opsiyonel)
        err.animate(
          [{ transform:'translateX(0)' }, { transform:'translateX(-4px)' }, { transform:'translateX(0)' }],
          { duration: 150, iterations: 2 }
        );
      }
    } finally {
      if (btn) { btn.disabled = false; delete btn.dataset.loading; }
    }
  }

  form?.addEventListener('submit', onSubmit);

  // Şifre alanında Enter → submit
  pass?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') form?.requestSubmit?.();
  });
})();
