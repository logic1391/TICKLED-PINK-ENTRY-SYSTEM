
    // ── CONFIG (loaded from server) ──
    let CFG = {};
    let authToken = '';
    let authRole = '';
    let selTkt = null, glOK = false, reentryMode = false;
    let pendPin = null, pinBuf = '';
    let camStream = null, camActive = false, camInterval = null;
    let s1Busy = false;
    let pendingCheckin = null; // stores form data during payment

    // ── API Helper ──
    async function api(url, opts = {}) {
      const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
      const resp = await fetch(url, { ...opts, headers });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw { status: resp.status, ...data };
      return data;
    }

    // ── INIT ──
    window.onload = async () => {
      try {
        CFG = await api('/api/auth/config');
      } catch (e) {
        console.error('Failed to load config:', e);
        CFG = { clubName: 'VOIDCLUB', eventName: '', maxCapacity: 300, maxPartySize: 5, devMode: true, doorsOpen: '21:00', doorsClose: '03:00', tickets: [] };
      }

      document.getElementById('nav-logo').textContent = CFG.clubName;
      document.getElementById('hdr-club').textContent = CFG.clubName;
      document.getElementById('hdr-event').textContent = CFG.eventName || 'Secure your entry pass';
      document.getElementById('p-club').textContent = CFG.clubName;
      document.getElementById('p-evname').textContent = (CFG.eventName || '') + ' · ENTRY PASS';
      buildAgeFields(); checkWindow(); updateBadge();
      setInterval(updateBadge, 60000);
    };

    // ── FORMATTERS ──
    function fmtAadhar(el) { let v = el.value.replace(/\D/g, '').slice(0, 12); el.value = v.replace(/(\d{4})(?=\d)/g, '$1 ').trim(); }
    function validAadhar(r) { return /^\d{12}$/.test(r.replace(/\s/g, '')); }
    function rawAadhar(r) { return r.replace(/\s/g, ''); }
    function maskWA(n) { return n ? '••••••' + n.slice(-4) : '—'; }
    function maskAA(a) { return a && a.length === 12 ? 'XXXX XXXX ' + a.slice(-4) : '—'; }
    function fmtT(ts) { return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); }

    // ── ENTRY WINDOW ──
    function inWindow() {
      const now = new Date();
      const [oh, om] = CFG.doorsOpen.split(':').map(Number);
      const [ch, cm] = CFG.doorsClose.split(':').map(Number);
      const nowM = now.getHours() * 60 + now.getMinutes();
      const openM = oh * 60 + om; let closeM = ch * 60 + cm;
      if (closeM < openM) closeM += 1440;
      const adjNow = nowM < openM ? nowM + 1440 : nowM;
      return adjNow >= openM && adjNow <= closeM;
    }

    function checkWindow() {
      const open = CFG.devMode ? true : inWindow();
      document.getElementById('ban-closed').style.display = !open ? 'block' : 'none';
      document.getElementById('ban-full').style.display = 'none'; // server handles capacity
      document.getElementById('checkin-body').style.display = open ? 'block' : 'none';
      if (!open) document.getElementById('ban-closed-msg').textContent = 'Doors open ' + CFG.doorsOpen + ' – ' + CFG.doorsClose;
    }

    function updateBadge() {
      const open = CFG.doorsOpen ? inWindow() : true;
      const dot = document.getElementById('wdot'), lbl = document.getElementById('wlbl');
      if (!dot || !lbl) return;
      dot.className = 'wdot' + (open ? '' : ' off');
      lbl.textContent = open ? 'Doors open · ' + CFG.doorsOpen + '–' + CFG.doorsClose : 'Doors closed · Opens ' + CFG.doorsOpen;
    }

    // ── NAV ──
    function gotoPage(id, btn) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('page-' + id).classList.add('active');
      if (btn) btn.classList.add('active');
      if (id !== 'scanner') stopCam();
      if (id === 'admin') { renderStats(); renderTbl(); }
      if (id === 'guestlist') { renderGL(); }
      if (id === 'scanner') { updateBadge(); hideRes(); }
      if (id === 'checkin') { checkWindow(); }
    }

    function needPin(role, page, btn) {
      // Always require PIN — no session bypass
      pendPin = { role, page, btn }; pinBuf = ''; updDots();
      document.getElementById('pin-title').textContent = role === 'admin' ? '🔒 ADMIN ACCESS' : '🔒 BOUNCER ACCESS';
      document.getElementById('pin-sub').textContent = role === 'admin' ? 'Enter Admin PIN' : 'Enter Bouncer PIN';
      document.getElementById('pin-err').style.display = 'none';
      document.getElementById('pin-ov').style.display = 'flex';
    }

    // ── PIN (server-verified) ──
    function pk(k) { if (pinBuf.length >= 4) return; pinBuf += k; updDots(); if (pinBuf.length === 4) setTimeout(chkPin, 100); }

    async function chkPin() {
      try {
        const { token, role } = await api('/api/auth/verify', {
          method: 'POST',
          body: JSON.stringify({ pin: pinBuf })
        });
        authToken = token;
        authRole = role;
        document.getElementById('pin-ov').style.display = 'none';
        const { page, btn } = pendPin;
        gotoPage(page, btn);
      } catch (e) {
        const err = document.getElementById('pin-err');
        err.textContent = 'Incorrect PIN. Try again.';
        err.style.display = 'block';
        pinBuf = ''; updDots();
      }
    }

    function pdel() { pinBuf = pinBuf.slice(0, -1); updDots(); }
    function pcancel() { document.getElementById('pin-ov').style.display = 'none'; }
    function updDots() { for (let i = 0; i < 4; i++) document.getElementById('pd' + i).className = 'pd' + (i < pinBuf.length ? ' f' : ''); }

    // ── AGE FIELDS ──
    function buildAgeFields() {
      const sz = parseInt(document.getElementById('fp').value) || 1;
      const w = document.getElementById('age-wrap');
      const L = ['You', ...Array.from({ length: sz - 1 }, (_, i) => 'Guest ' + (i + 1))];
      if (sz === 1) {
        w.innerHTML = '<label>Your Age</label><input id="age0" type="number" min="18" max="99" step="1" placeholder="Must be 18+" oninput="if(this.value>99)this.value=99;" onkeydown="if(event.key===\'Enter\') s1next()">';
      } else {
        w.innerHTML = `<label>Ages — all ${sz} people <span style="color:var(--accent)">· ALL must be 18+</span></label>
        <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.5rem">One box per person · e.g. <span style="color:var(--accent2)">${Array.from({ length: sz }, (_, i) => 18 + i).join(', ')}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:0.5rem">
        ${L.map((l, i) => `<div><div style="font-size:0.68rem;color:var(--muted);margin-bottom:3px;text-transform:uppercase">${l}</div>
        <input id="age${i}" type="number" min="18" max="99" step="1" oninput="if(this.value>99)this.value=99;" onkeydown="if(event.key==='Enter') s1next()" placeholder="Age" style="padding:0.6rem 0.75rem;font-size:0.9rem"></div>`).join('')}
        </div><div style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem">⚠️ Any person under 18 = entire group denied</div>`;
      }
    }

    // ── STEP 1 ──
    function s1next() {
      if (s1Busy) return;
      const name = document.getElementById('fn').value.trim();
      const wa = document.getElementById('fw').value.trim();
      const aaRaw = rawAadhar(document.getElementById('fa').value);
      const sz = parseInt(document.getElementById('fp').value) || 1;
      const err = document.getElementById('s1-err');
      err.classList.remove('show');
      const E = (m) => { err.textContent = m; err.classList.add('show'); err.scrollIntoView({behavior: 'smooth', block: 'center'}); };

      if (!name) return E('Enter your full name.');
      if (wa.length !== 10) return E('Enter a valid 10-digit WhatsApp number.');
      if (!validAadhar(aaRaw)) return E('Invalid Aadhaar — exactly 12 digits required.');

      // Age validation
      const ages = [];
      for (let i = 0; i < sz; i++) {
        const raw = document.getElementById('age' + i)?.value;
        const v = Number(raw);
        if (!raw || !Number.isInteger(v) || v < 1) return E('Enter a whole number age for: ' + (i === 0 ? 'yourself' : 'Guest ' + i) + '.');
        if (v < 18) return E((i === 0 ? 'You' : 'Guest ' + i) + ' must be 18+. Entire group denied.');
        if (v > 99) return E('Age cannot exceed 99 for: ' + (i === 0 ? 'yourself' : 'Guest ' + i) + '.');
        ages.push(v);
      }

      // Store form data for later
      pendingCheckin = { name, wa, aadhar: aaRaw, party: sz, ages };

      // Lock button briefly
      s1Busy = true;
      const btn = document.getElementById('s1-btn');
      btn.classList.add('loading'); btn.disabled = true;
      setTimeout(() => { s1Busy = false; btn.classList.remove('loading'); btn.disabled = false; }, 800);

      gotoStep(2);
    }

    // ── TICKET GRID ──
    function buildTGrid() {
      const party = pendingCheckin?.party || parseInt(document.getElementById('fp')?.value) || 1;
      if (!CFG.tickets) return;
      document.getElementById('tgrid').innerHTML = CFG.tickets.map(t => `
        <div class="topt" data-id="${t.id}" onclick="selTkt2('${t.id}')">
          <div><div class="tn" style="color:${t.color}">${t.name}</div><div class="td2">${t.desc}</div></div>
          <div style="text-align:right">
            <div class="tp">₹${(t.price * party).toLocaleString('en-IN')}</div>
            ${party > 1 ? `<div style="font-size:0.7rem;color:var(--muted)">${party}×₹${t.price}</div>` : ''}
          </div>
        </div>`).join('');
    }

    function selTkt2(id) {
      selTkt = CFG.tickets.find(t => t.id === id);
      document.querySelectorAll('.topt').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
      document.getElementById('glvbox').style.display = id === 'guestlist' ? 'block' : 'none';
      if (id !== 'guestlist') glOK = false;
    }

    // ── GUEST LIST VERIFY (API) ──
    async function verifyGL() {
      const wa = document.getElementById('glw').value.trim();
      const name = document.getElementById('gln').value.trim();
      const E = document.getElementById('gl-err'), OK = document.getElementById('gl-ok');
      E.classList.remove('show'); OK.classList.remove('show');
      if (!wa || !name) { E.textContent = 'Enter both WhatsApp and name.'; E.classList.add('show'); return; }

      try {
        const pSz = pendingCheckin?.party || 1;
        const result = await api('/api/guestlist/verify', {
          method: 'POST',
          body: JSON.stringify({ wa, name })
        });
        if (pSz > result.entry.party_allowed) {
          E.textContent = `⚠️ Party of ${pSz} exceeds allowed ${result.entry.party_allowed}.`;
          E.classList.add('show'); return;
        }
        OK.textContent = '✅ Verified! Welcome, ' + result.entry.name;
        OK.classList.add('show');
        glOK = true;
      } catch (e) {
        E.textContent = e.error || 'Verification failed.';
        E.classList.add('show');
      }
    }

    // ── STEP 2 ──
    function s2next() {
      if (!selTkt) { alert('Select a ticket type.'); return; }
      if (selTkt.id === 'guestlist' && !glOK) { alert('Verify guest list first.'); return; }
      const party = pendingCheckin?.party || 1;
      const total = selTkt.price * party;
      document.getElementById('pay-amt').textContent = '₹' + total.toLocaleString('en-IN');
      document.getElementById('pay-desc').textContent = selTkt.name + ' · ' + party + ' person' + (party > 1 ? 's' : '');
      document.getElementById('pay-brk').textContent = party > 1 ? party + '×₹' + selTkt.price + ' = ₹' + total.toLocaleString('en-IN') : '';
      gotoStep(3);
    }

    // ── PAYMENT (Razorpay or Mock) ──
    async function openPay() {
      const party = pendingCheckin?.party || 1;
      const total = selTkt.price * party;

      try {
        // Create order on server
        const order = await api('/api/payments/create-order', {
          method: 'POST',
          body: JSON.stringify({
            amount: total,
            ticketType: selTkt.id,
            party,
            name: pendingCheckin?.name || ''
          })
        });

        if (order.mock) {
          // Mock mode — simulate payment immediately
          await api('/api/payments/verify', {
            method: 'POST',
            body: JSON.stringify({
              razorpay_order_id: order.orderId,
              razorpay_payment_id: 'pay_mock_' + Date.now(),
              razorpay_signature: 'mock'
            })
          });
          completeCI(order.orderId, 'pay_mock_' + Date.now());
          return;
        }

        // Real Razorpay checkout
        const options = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: CFG.clubName,
          description: selTkt.name + ' Entry',
          order_id: order.orderId,
          handler: async function (response) {
            try {
              await api('/api/payments/verify', {
                method: 'POST',
                body: JSON.stringify(response)
              });
              completeCI(response.razorpay_order_id, response.razorpay_payment_id);
            } catch (e) {
              alert('Payment verification failed. Contact support.');
            }
          },
          prefill: {
            name: pendingCheckin?.name || '',
            contact: pendingCheckin?.wa || ''
          },
          theme: { color: '#FF3B3B' }
        };

        const rzp = new Razorpay(options);
        rzp.open();

      } catch (e) {
        console.error('[PAYMENT]', e);
        alert('Failed to initiate payment. Please try again.');
      }
    }

    // ── COMPLETE CHECK-IN (API) ──
    async function completeCI(orderId, paymentId) {
      if (!pendingCheckin || !selTkt) return;

      const party = pendingCheckin.party;
      const total = selTkt.price * party;

      try {
        const result = await api('/api/guests/checkin', {
          method: 'POST',
          body: JSON.stringify({
            name: pendingCheckin.name,
            wa: pendingCheckin.wa,
            aadhar: pendingCheckin.aadhar,
            type: selTkt.id,
            typeName: selTkt.name,
            party,
            ages: pendingCheckin.ages,
            pricePerPerson: selTkt.price,
            priceTotal: total,
            paymentId,
            orderId
          })
        });

        const g = result.guest;

        // Render pass
        document.getElementById('p-name').textContent = g.name;
        document.getElementById('p-type').textContent = g.type_name;
        document.getElementById('p-party').textContent = g.party + (g.party > 1 ? ' people' : ' person');
        document.getElementById('p-paid').textContent = '₹' + g.price_total.toLocaleString('en-IN');
        document.getElementById('p-valid').textContent = CFG.doorsOpen + ' – ' + CFG.doorsClose + ' · Tonight only';
        document.getElementById('p-tok').innerHTML = g.token + '<small>TOKEN</small>';
        document.getElementById('resend-btn').dataset.token = g.token;

        // Show loading → QR → pass
        gotoStep(4);
        document.getElementById('pass-loading').style.display = 'block';
        document.getElementById('pass-ready').style.display = 'none';

        const qrEl = document.getElementById('pass-qr');
        qrEl.innerHTML = '';
        setTimeout(() => {
          new QRCode(qrEl, {
            text: JSON.stringify({ token: g.token, name: g.name, type: g.type, party: g.party, ts: g.created_at, eventDate: g.event_date }),
            width: 140, height: 140, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.H
          });
          const waitForQR = setInterval(() => {
            if (qrEl.querySelector('canvas') || qrEl.querySelector('img')) {
              clearInterval(waitForQR);
              document.getElementById('pass-loading').style.display = 'none';
              document.getElementById('pass-ready').style.display = 'block';
            }
          }, 100);
        }, 50);

      } catch (e) {
        console.error('[CHECKIN]', e);
        alert(e.error || 'Check-in failed. Please try again.');
      }
    }

    // ── RESEND WHATSAPP ──
    async function resendWA() {
      const tok = document.getElementById('resend-btn').dataset.token;
      if (!tok) return alert('No token found.');
      try {
        await api('/api/guests/resend/' + tok, { method: 'POST' });
        alert('Resent to WhatsApp!');
      } catch (e) {
        alert('Failed to resend.');
      }
    }

    function resetCI() {
      document.getElementById('fn').value = '';
      document.getElementById('fw').value = '';
      document.getElementById('fa').value = '';
      document.getElementById('fp').value = '1';
      buildAgeFields();
      pendingCheckin = null;
      gotoStep(1);
    }

    // ── STEPS ──
    function gotoStep(n) {
      [1, 2, 3, 4].forEach(i => {
        document.getElementById('s' + i).style.display = i === n ? 'block' : 'none';
        const el = document.getElementById('pr' + i);
        el.className = 'ps' + (i < n ? ' done' : i === n ? ' active' : '');
      });
      if (n === 2) { buildTGrid(); selTkt = null; glOK = false; document.getElementById('glvbox').style.display = 'none'; }
      window.scrollTo(0, 0);
    }

    function resetCI() {
      selTkt = null; glOK = false; pendingCheckin = null;
      ['fn', 'fw', 'fa'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('fp').value = '1'; buildAgeFields();
      document.getElementById('s1-err').classList.remove('show');
      gotoStep(1); checkWindow();
    }

    // ── SCANNER ──
    const hasBarcodeDetector = 'BarcodeDetector' in window;

    async function toggleCam() {
      if (camActive) { stopCam(); return; }
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
        const vid = document.getElementById('scvid');
        vid.srcObject = camStream;
        vid.addEventListener('loadedmetadata', () => {
          document.getElementById('cam-btn').textContent = 'Stop Camera';
          document.getElementById('scan-engine-lbl').textContent =
            hasBarcodeDetector ? 'Engine: jsQR + BarcodeDetector' : 'Engine: jsQR';
          camActive = true; startScan();
        }, { once: true });
      } catch (e) { alert('Camera access denied or unavailable.'); }
    }

    function stopCam() {
      if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
      if (camInterval) { clearInterval(camInterval); camInterval = null; }
      camActive = false;
      document.getElementById('cam-btn').textContent = 'Start Camera';
      document.getElementById('scan-engine-lbl').textContent = '—';
    }

    function startScan() {
      const vid = document.getElementById('scvid');
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      camInterval = setInterval(() => {
        if (!camActive || !vid.videoWidth) return;
        cv.width = vid.videoWidth; cv.height = vid.videoHeight;
        ctx.drawImage(vid, 0, 0);

        // 1. Try jsQR first (works on HTTP & HTTPS, dark & light backgrounds)
        const imageData = ctx.getImageData(0, 0, cv.width, cv.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
        if (code) { verifyTok(code.data); stopCam(); return; }

        // 2. Fallback to BarcodeDetector (often faster, but restricted to HTTPS in some browsers)
        if (hasBarcodeDetector) {
          new BarcodeDetector({ formats: ['qr_code'] }).detect(cv).then(codes => {
            if (codes.length > 0) { verifyTok(codes[0].rawValue); stopCam(); }
          }).catch(() => {});
        }
      }, 300);
    }

    function manualV() {
      const inp = document.getElementById('mtok');
      const t = inp.value.trim().toUpperCase();
      if (!t) return;
      verifyTok(t);
      inp.value = '';
    }

    // ── VERIFY TOKEN (API) ──
    async function verifyTok(raw) {
      if (!authToken) {
        alert('Session expired. Please re-enter bouncer PIN.');
        needPin('bouncer', 'scanner', document.querySelectorAll('.tab-btn')[1]);
        return;
      }
      hideRes();
      let tok = raw.trim().toUpperCase();
      try { const o = JSON.parse(raw); tok = o.token.toUpperCase(); } catch (e) {}

      try {
        const result = await api('/api/guests/scan/' + tok, {
          method: 'POST',
          body: JSON.stringify({ reentry: reentryMode })
        });

        const g = result.guest;

        if (result.status === 'reentry') {
          document.getElementById('r-re-name').textContent = g.name.toUpperCase();
          document.getElementById('r-re-det').innerHTML =
            '<span style="color:var(--green)">Let in ' + g.party + (g.party > 1 ? ' people' : ' person') + '</span> · ' + g.type_name +
            '<br><span style="font-size:0.8rem;color:var(--muted)">First scanned ' + fmtT(g.scan_time || g.created_at) + '</span>';
          document.getElementById('r-reentry').style.display = 'block';
          return;
        }

        // Success
        document.getElementById('r-ok-name').textContent = g.name.toUpperCase();
        document.getElementById('r-ok-det').innerHTML =
          '<span style="font-size:1.1rem;font-weight:600;color:var(--green)">Let in ' + g.party + (g.party > 1 ? ' people' : ' person') + '  ·  ' + g.type_name + '</span>' +
          '<br><span style="font-size:0.82rem;color:var(--muted)">Token ' + g.token + ' · Paid ₹' + g.price_total.toLocaleString('en-IN') + '</span>';
        document.getElementById('r-ok').style.display = 'block';

      } catch (e) {
        if (e.status === 401 || e.status === 403) {
          // Auth expired — force re-auth
          authToken = ''; authRole = '';
          alert('Session expired. Please re-enter bouncer PIN.');
          needPin('bouncer', 'scanner', document.querySelectorAll('.tab-btn')[1]);
        } else if (e.error === 'closed') {
          document.getElementById('r-closed-msg').textContent = e.message;
          document.getElementById('r-closed').style.display = 'block';
        } else if (e.error === 'invalid') {
          document.getElementById('r-fail').style.display = 'block';
        } else if (e.error === 'expired') {
          document.getElementById('r-exp-det').textContent = e.message;
          document.getElementById('r-exp').style.display = 'block';
        } else if (e.error === 'duplicate') {
          const g = e.guest;
          document.getElementById('r-dup-det').textContent = g.name + ' · Scanned at ' + fmtT(g.scan_time || g.created_at);
          document.getElementById('r-dup').style.display = 'block';
        } else {
          document.getElementById('r-fail').style.display = 'block';
        }
      }
    }

    function hideRes() { ['r-ok', 'r-fail', 'r-dup', 'r-closed', 'r-exp', 'r-reentry'].forEach(id => document.getElementById(id).style.display = 'none'); }

    // ── STATS (API) ──
    async function renderStats() {
      try {
        const s = await api('/api/guests/stats');
        document.getElementById('st-in').textContent = s.scannedIn;
        document.getElementById('st-vip').textContent = s.vip;
        document.getElementById('st-gen').textContent = s.general;
        document.getElementById('st-gl').textContent = s.guestlist;
        document.getElementById('st-book').textContent = s.bookings;
        document.getElementById('st-rev').textContent = '₹' + s.revenue.toLocaleString('en-IN');
        document.getElementById('st-dup').textContent = s.dupCount;
        document.getElementById('st-wait').textContent = s.waiting;
        document.getElementById('cap-lbl').textContent = s.totalPeople + ' / ' + s.maxCapacity;
        const pct = Math.min(100, Math.round(s.totalPeople / s.maxCapacity * 100));
        const f = document.getElementById('cap-fill');
        f.style.width = pct + '%';
        f.style.background = pct >= 95 ? 'var(--red)' : pct >= 80 ? 'var(--yellow)' : 'var(--green)';
      } catch (e) { console.error('[STATS]', e); }
    }

    // ── ADMIN TABLE (API) ──
    async function renderTbl() {
      try {
        const q = (document.getElementById('s-inp')?.value || '');
        const guests = await api('/api/guests?q=' + encodeURIComponent(q));
        const tb = document.getElementById('atbl'); if (!tb) return;
        tb.innerHTML = guests.length === 0
          ? `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:2rem">No check-ins yet</td></tr>`
          : guests.map(g => `<tr>
            <td><span style="font-family:'Bebas Neue',sans-serif;letter-spacing:0.1em">${g.token}</span></td>
            <td>${g.name}</td><td>${maskWA(g.wa)}</td><td>${maskAA(g.aadhar)}</td>
            <td><span class="badge ${g.type}">${g.type_name}</span></td>
            <td>${g.party} ${g.party > 1 ? 'ppl' : 'person'}</td>
            <td>₹${g.price_total.toLocaleString('en-IN')}${g.party > 1 ? `<br><span style="font-size:0.7rem;color:var(--muted)">${g.party}×₹${g.price_per_person}</span>` : ''}</td>
            <td>${fmtT(g.created_at)}</td>
            <td><span class="badge ${g.scanned ? 'used' : 'waiting'}">${g.scanned ? '✓ In' : 'Waiting'}</span></td>
          </tr>`).join('');
      } catch (e) { console.error('[TABLE]', e); }
    }

    // ── GUEST LIST (API) ──
    async function addGL() {
      const name = document.getElementById('gl-nm').value.trim();
      const wa = document.getElementById('gl-wa').value.trim();
      const ps = parseInt(document.getElementById('gl-ps').value) || 1;
      const err = document.getElementById('gl-add-err');
      err.style.display = 'none';

      try {
        await api('/api/guestlist', {
          method: 'POST',
          body: JSON.stringify({ name, wa, partyAllowed: ps })
        });
        document.getElementById('gl-nm').value = '';
        document.getElementById('gl-wa').value = '';
        document.getElementById('gl-ps').value = '1';
        renderGL();
      } catch (e) {
        err.textContent = e.error || 'Failed to add.';
        err.style.display = 'block';
      }
    }

    async function removeGL(id) {
      if (!confirm('Remove this guest from the list?')) return;
      try {
        await api('/api/guestlist/' + id, { method: 'DELETE' });
        renderGL();
      } catch (e) {
        alert(e.error || 'Failed to remove.');
      }
    }

    async function markArrived(id) {
      try {
        await api('/api/guestlist/' + id + '/arrive', { method: 'POST' });
        renderGL();
      } catch (e) { alert(e.error || 'Failed.'); }
    }

    async function renderGL() {
      try {
        const data = await api('/api/guestlist');
        document.getElementById('gl-cnt').textContent = data.total;
        document.getElementById('gl-cin').textContent = data.checkedIn;
        const tb = document.getElementById('gltbl');
        tb.innerHTML = data.list.length === 0
          ? `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:2rem">No guests yet</td></tr>`
          : data.list.map((g, i) => `<tr>
            <td>${i + 1}</td><td>${g.name}</td><td>${maskWA(g.wa)}</td><td>${g.party_allowed} pax</td>
            <td><span class="badge ${g.status === 'checked-in' ? 'used' : 'waiting'}">${g.status === 'checked-in' ? '✓ In' : 'Waiting'}</span></td>
            <td style="display:flex;gap:0.4rem;flex-wrap:wrap">
              ${g.status === 'waiting' ? `<button class="btn gbtn sm" onclick="markArrived(${g.id})">✓ Mark Arrived</button>` : ''}
              ${g.status === 'waiting' ? `<button class="btn dbtn sm" onclick="removeGL(${g.id})">Remove</button>` : '—'}
            </td>
          </tr>`).join('');
      } catch (e) { console.error('[GL]', e); }
    }

    // ── CSV EXPORT ──
    async function exportCSV() {
      window.open('/api/guests/export?token=' + encodeURIComponent(authToken), '_blank');
    }
    async function exportGL() {
      window.open('/api/guestlist/export?token=' + encodeURIComponent(authToken), '_blank');
    }

    // ── CLEAR EVENT DATA ──
    async function clearEventData() {
      if (!confirm('⚠️ This will delete ALL check-in records for tonight.\n\nGuest list will be kept.\n\nAre you sure?')) return;
      try {
        await api('/api/guests/clear', { method: 'DELETE' });
        alert('Event data cleared. Guest list preserved.');
        renderStats(); renderTbl();
      } catch (e) { alert(e.error || 'Failed to clear.'); }
    }
  