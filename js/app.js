/* ==========================================================================
   BAHAMAS — Tailwind front-end
   Menu filters · Cart + WhatsApp/API checkout · Reservations · Micro-UX
   API-first with graceful WhatsApp fallback (works on static hosting too).
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const money = (n) => 'UGX ' + Number(n || 0).toLocaleString('en-UG');
  const WA = '256762831177';
  const FALLBACK_IMG = 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=600';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg><span></span>';
    t.lastChild.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2100);
  }

  /* ---------------- Header scroll + active nav ---------------- */
  const hdr = $('#hdr');
  const navLinks = $$('#nav .nav-link');
  function onScroll() {
    hdr.classList.toggle('scrolled', window.scrollY > 40);
    const ids = ['home', 'about', 'menu', 'reserve', 'contact'];
    let current = 'home';
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= 160) current = id;
    }
    navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + current));
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------- Mobile nav ---------------- */
  const nav = $('#nav');
  const menuToggle = $('#menuToggle');
  menuToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuToggle.textContent = open ? '✕' : '☰';
    menuToggle.setAttribute('aria-expanded', String(open));
  });
  navLinks.forEach((a) => a.addEventListener('click', () => {
    nav.classList.remove('open');
    menuToggle.textContent = '☰';
    menuToggle.setAttribute('aria-expanded', 'false');
  }));

  /* ---------------- Reveal on scroll ---------------- */
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }),
    { threshold: 0.12 }
  );
  $$('.reveal').forEach((el) => io.observe(el));

  /* ---------------- Menu data ---------------- */
  let MENU = [];
  const grid = $('#menuGrid');

  async function loadMenu() {
    try {
      const res = await fetch('/api/menu', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.items) && data.items.length) {
          MENU = data.items.map(normalize);
          renderMenu('grill');
          return;
        }
      }
      throw new Error('api-empty');
    } catch (_e) {
      try {
        const res2 = await fetch('data/menu.json');
        if (res2.ok) {
          MENU = (await res2.json()).map(normalize);
          renderMenu('grill');
          return;
        }
      } catch (_e2) { /* fall through */ }
      MENU = (window.BAHAMAS_MENU_FALLBACK || []).map(normalize);
      renderMenu('grill');
    }
  }

  // Accept both API rows (popular 0/1, no combo/from) and JSON rows
  function normalize(m) {
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      price: Number(m.price),
      description: m.description || '',
      image: m.image || FALLBACK_IMG,
      badge: m.badge || '',
      combo: !!(m.combo || /combo/i.test(m.badge || '')),
      from: !!(m.from || m.from_price),
    };
  }

  function dishHTML(x) {
    const tag = x.badge ? `<span class="tag${x.combo ? ' tag-combo' : ''}">${esc(x.badge)}</span>` : '';
    const price = `${x.from ? '<small class="text-xs text-sage font-medium">from </small>' : ''}${money(x.price)}`;
    return `
      <div class="dish-img">${tag}<img loading="lazy" src="${esc(x.image)}" alt="${esc(x.name)}" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'"></div>
      <div class="p-[26px]">
        <div class="flex justify-between items-baseline gap-3 mb-2">
          <h3 class="font-sans text-[26px] font-semibold text-white leading-none">${esc(x.name)}</h3>
          <span class="font-sans text-[22px] text-gold-lt whitespace-nowrap">${price}</span>
        </div>
        <p class="text-sage text-sm mb-5 min-h-[44px]">${esc(x.description)}</p>
        <button class="dish-add" data-add="${esc(x.id)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>Add to Order
        </button>
      </div>`;
  }

  function renderMenu(cat) {
    const items = MENU.filter((m) => m.category === cat);
    grid.innerHTML = '';
    if (!items.length) {
      grid.innerHTML = '<p class="text-sage col-span-full text-center py-10">No dishes in this category yet — check back soon.</p>';
      return;
    }
    items.forEach((x, i) => {
      const card = document.createElement('article');
      card.className = 'dish';
      card.innerHTML = dishHTML(x);
      grid.appendChild(card);
      setTimeout(() => card.classList.add('shown'), 50 * i);
    });
  }

  $$('.tab-chip').forEach((b) => b.addEventListener('click', () => {
    $$('.tab-chip').forEach((x) => {
      x.classList.remove('active');
      x.setAttribute('aria-selected', 'false');
    });
    b.classList.add('active');
    b.setAttribute('aria-selected', 'true');
    renderMenu(b.dataset.cat);
  }));

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (btn) addToCart(btn.dataset.add);
  });

  /* ---------------- Cart ---------------- */
  const CART_KEY = 'bahamas_cart_v2';
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (_e) { cart = []; }

  const cartOv = $('#cartOv');
  const cartList = $('#cartList');

  const save = () => localStorage.setItem(CART_KEY, JSON.stringify(cart));
  const totals = () => ({
    count: cart.reduce((a, c) => a + c.qty, 0),
    total: cart.reduce((a, c) => a + c.price * c.qty, 0),
  });

  function addToCart(id) {
    const item = MENU.find((m) => m.id === id);
    if (!item) return;
    const line = cart.find((c) => c.id === id);
    if (line) line.qty = Math.min(line.qty + 1, 20);
    else cart.push({ id: item.id, name: item.name, price: item.price, image: item.image, qty: 1 });
    save();
    renderCart();
    toast(item.name + ' added');
  }

  function renderCart() {
    const { count, total } = totals();
    $('#cc').textContent = count;
    $('#cTotal').textContent = money(total);
    $('#checkoutBtn').disabled = !cart.length;
    if (!cart.length) {
      cartList.innerHTML = `<div class="h-full grid place-items-center text-center text-sage p-10">
        <div>
          <svg class="w-[60px] h-[60px] mx-auto mb-4 opacity-60" viewBox="0 0 24 24" fill="none" stroke="#b8944a" stroke-width="1"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/></svg>
          <p>Your order is empty.</p>
        </div>
      </div>`;
      return;
    }
    cartList.innerHTML = cart.map((it, k) => `
      <div class="grid grid-cols-[66px_1fr_auto] gap-3.5 py-4 border-b border-gold/10 [animation:fade-up_.3s_ease]">
        <img src="${esc(it.image)}" alt="" class="w-[66px] h-[66px] object-cover" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
        <div>
          <h5 class="font-sans text-[19px] text-white leading-tight">${esc(it.name)}</h5>
          <div class="text-gold-lt font-sans text-sm mt-0.5">${money(it.price)}</div>
          <div class="flex items-center gap-2.5 mt-[9px]">
            <button data-dec="${k}" aria-label="Decrease quantity" class="w-7 h-7 border border-gold/30 bg-transparent text-cream cursor-pointer transition hover:bg-gold hover:text-deep">−</button>
            <span class="min-w-5 text-center font-sans">${it.qty}</span>
            <button data-inc="${k}" aria-label="Increase quantity" class="w-7 h-7 border border-gold/30 bg-transparent text-cream cursor-pointer transition hover:bg-gold hover:text-deep">+</button>
          </div>
        </div>
        <button data-del="${k}" aria-label="Remove item" class="bg-transparent border-0 text-clay text-xl cursor-pointer self-start leading-none">×</button>
      </div>`).join('');
  }

  cartList.addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    const del = e.target.closest('[data-del]');
    if (inc) cart[+inc.dataset.inc].qty = Math.min(cart[+inc.dataset.inc].qty + 1, 20);
    else if (dec) {
      const k = +dec.dataset.dec;
      cart[k].qty -= 1;
      if (cart[k].qty < 1) cart.splice(k, 1);
    } else if (del) cart.splice(+del.dataset.del, 1);
    else return;
    save();
    renderCart();
  });

  function toggleCart(force) {
    const open = force !== undefined ? force : !cartOv.classList.contains('open');
    cartOv.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }
  $('#cartBtn').addEventListener('click', () => toggleCart(true));
  cartOv.addEventListener('click', (e) => {
    if (e.target === cartOv || e.target.closest('[data-cart-close]')) toggleCart(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleCart(false);
  });

  /* ---------------- Checkout: API-first, WhatsApp fallback ---------------- */
  $('#checkoutBtn').addEventListener('click', async () => {
    if (!cart.length) return;
    const name = $('#oName').value.trim();
    const phone = $('#oPhone').value.trim();
    const loc = $('#oLoc').value.trim();
    if (name.length < 2) return toast('Please enter your name');
    if (!/^[+\d][\d\s\-()]{6,18}$/.test(phone)) return toast('Enter a valid phone number');

    const { total } = totals();
    const items = cart.map((c) => ({ id: c.id, qty: c.qty }));
    const btn = $('#checkoutBtn');
    btn.disabled = true;

    let ref = '';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { name, phone, address: loc },
          orderType: loc ? 'delivery' : 'pickup',
          notes: '',
          items,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) ref = data.reference;
    } catch (_e) { /* offline/static hosting — WhatsApp only */ }

    let t = `*NEW ORDER — BAHAMAS*%0A%0A*Name:* ${encodeURIComponent(name)}%0A*Phone:* ${encodeURIComponent(phone)}%0A*Location:* ${encodeURIComponent(loc || 'Not specified')}%0A`;
    if (ref) t += `*Ref:* ${encodeURIComponent(ref)}%0A`;
    t += `%0A*ITEMS*%0A`;
    cart.forEach((it, i) => {
      t += `${i + 1}. ${encodeURIComponent(it.name)} ×${it.qty} — ${encodeURIComponent(money(it.price * it.qty))}%0A`;
    });
    t += `%0A*TOTAL: ${encodeURIComponent(money(total))}*%0A%0APlease confirm delivery fee. Thank you!`;
    window.open(`https://wa.me/${WA}?text=${t}`, '_blank');

    cart = [];
    save();
    renderCart(); // owns the disabled state (stays disabled on empty cart)
    $('#oName').value = '';
    $('#oPhone').value = '';
    $('#oLoc').value = '';
    toggleCart(false);
    toast(ref ? `Order ${ref} sent!` : 'Order sent via WhatsApp!');
  });

  /* ---------------- Reservation: API-first, WhatsApp fallback ---------------- */
  const dateInput = $('#rDate');
  dateInput.min = new Date().toISOString().slice(0, 10);

  $('#resForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: $('#rName').value.trim(),
      email: $('#rEmail').value.trim(),
      mobile: $('#rPhone').value.trim(),
      date: dateInput.value,
      time: $('#rTime').value,
      persons: $('#rPax').value,
    };
    if (payload.name.length < 2) return toast('Please enter your name');
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return toast('Invalid email address');
    if (!/^[+\d][\d\s\-()]{6,18}$/.test(payload.mobile)) return toast('Enter a valid mobile number');
    if (!payload.date) return toast('Please choose a date');
    if (!payload.time) return toast('Please choose a time');
    if (!payload.persons) return toast('Choose number of persons');

    const btn = $('#resSubmit');
    btn.disabled = true;
    btn.style.opacity = '.6';

    let ref = '';
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        ref = data.reference;
      } else if (data && data.error) {
        toast(data.error);
        btn.disabled = false;
        btn.style.opacity = '';
        return;
      }
    } catch (_e) { /* offline/static hosting — WhatsApp only */ }

    const t = `*TABLE RESERVATION — BAHAMAS*%0A%0A*Name:* ${encodeURIComponent(payload.name)}%0A*Email:* ${encodeURIComponent(payload.email || '—')}%0A*Phone:* ${encodeURIComponent(payload.mobile)}%0A*Date:* ${encodeURIComponent(payload.date)}%0A*Time:* ${encodeURIComponent(payload.time)}%0A*Guests:* ${encodeURIComponent(payload.persons)}${ref ? `%0A*Ref:* ${encodeURIComponent(ref)}` : ''}%0A%0APlease confirm my reservation. Thank you!`;
    window.open(`https://wa.me/${WA}?text=${t}`, '_blank');
    e.target.reset();
    dateInput.min = new Date().toISOString().slice(0, 10);
    toast('Reservation sent!');
    btn.disabled = false;
    btn.style.opacity = '';
  });

  /* ---------------- Misc ---------------- */
  $('#yr').textContent = new Date().getFullYear();

  /* ---------------- Init ---------------- */
  renderCart();
  loadMenu();
})();
