(function () {
  'use strict';
  var query = new URLSearchParams(location.search);
  var id = query.get('id') || '', token = query.get('token') || '';
  var status = document.getElementById('status'), payment = document.getElementById('payment');
  var endpoint = '/api/promptpay?id=' + encodeURIComponent(id) + '&token=' + encodeURIComponent(token);
  var imageUrl = endpoint + '&image=1';
  var file, timer, busy = false;
  async function check() {
    if (busy) return;
    busy = true;
    try {
      var response = await fetch(endpoint, { cache: 'no-store' });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'ไม่สามารถโหลดรายการได้');
      document.getElementById('order').textContent = 'คำสั่งซื้อ: ' + data.order_ref;
      document.getElementById('amount').textContent = 'ยอดชำระ ' + new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(data.amount);
      if (data.status === 'succeeded') {
        payment.hidden = true; status.textContent = 'ชำระเงินสำเร็จ กำลังเปิดหน้าสรุปคำสั่งซื้อ…';
        location.replace((data.wholesale ? '/wholesale/' : '/thank-you.html') + '?payment=stripe_success&paid=1&session_id=' + encodeURIComponent(id));
        return;
      }
      var expired = data.expires_at != null && data.expires_at * 1000 <= Date.now();
      if (expired || data.status !== 'requires_action' || data.qr_available === false) {
        payment.hidden = true;
        status.textContent = data.status === 'processing' ? 'กำลังตรวจสอบผลชำระเงิน กรุณารอสักครู่' : 'QR นี้หมดอายุหรือใช้ไม่ได้แล้ว กรุณากลับหน้าร้านเพื่อเริ่มรายการใหม่';
        if (data.status !== 'processing') return;
      } else {
        payment.hidden = false; status.textContent = 'รอการชำระเงิน';
        document.getElementById('expiry').textContent = data.expires_at
          ? 'ใช้ QR ได้ถึง ' + new Date(data.expires_at * 1000).toLocaleString('th-TH')
          : 'QR สำหรับคำสั่งซื้อนี้เท่านั้น กรุณาชำระเพียงครั้งเดียว';
        var qr = document.getElementById('qr');
        if (!qr.getAttribute('src')) {
          qr.src = imageUrl;
          qr.onerror = function () { document.getElementById('saveStatus').textContent = 'โหลดรูป QR ไม่สำเร็จ กรุณาโหลดหน้านี้ใหม่'; };
          document.getElementById('download').href = imageUrl + '&download=1';
          // Prepare the file before the tap to preserve mobile share activation.
          fetch(imageUrl).then(function (r) { if (!r.ok) throw new Error('QR unavailable'); return r.blob(); }).then(function (blob) {
            file = new File([blob], 'RAPTOR-PromptPay.png', { type: 'image/png' });
          }).catch(function () {});
        }
      }
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; }
    timer = setTimeout(check, 5000);
  }
  document.getElementById('download').addEventListener('click', async function (event) {
    if (!file || !navigator.share || !navigator.canShare || !navigator.canShare({ files: [file] })) {
      document.getElementById('saveStatus').textContent = 'หากรูปอยู่ในแอปไฟล์ ให้เปิดรูป กดแชร์ แล้วเลือกบันทึกรูปภาพ';
      return; // The link downloads the PNG when file sharing is unavailable.
    }
    event.preventDefault();
    try { await navigator.share({ files: [file] }); }
    catch (error) {
      if (error.name === 'AbortError') return;
      // Keep one visible action and download automatically if sharing fails.
      var fallback = document.createElement('a');
      fallback.href = imageUrl + '&download=1'; fallback.download = 'RAPTOR-PromptPay.png';
      document.body.appendChild(fallback); fallback.click(); fallback.remove();
      document.getElementById('saveStatus').textContent = 'ดาวน์โหลดรูป QR แล้ว หากรูปอยู่ในแอปไฟล์ ให้เปิดรูปแล้วเลือกบันทึกรูปภาพ';
    }
  });
  document.addEventListener('visibilitychange', function () { clearTimeout(timer); if (!document.hidden) check(); });
  check();
}());
