(() => {
  document.querySelectorAll('.raptor-contact-form').forEach(form => {
    let submissionId = crypto.randomUUID(), sending = false;
    const button = form.querySelector('button[type="submit"]');
    const status = document.createElement('p');
    status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    status.className='mt-3 text-sm'; form.appendChild(status);
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if (sending || !form.reportValidity()) return;
      sending=true; button.disabled=true; status.textContent='กำลังส่งข้อความ...';
      try {
        const fields=new FormData(form);
        const response=await fetch('/api/contact',{
          method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({submission_id:submissionId,customer_name:fields.get('customer_name'),contact:fields.get('contact'),message:fields.get('message'),website:fields.get('website')}),
          signal:AbortSignal.timeout(20000)
        });
        const result=await response.json();
        if (!response.ok || result.ok!==true) throw new Error(result.error || 'ส่งข้อความไม่สำเร็จ กรุณาลองอีกครั้ง');
        form.reset(); submissionId=crypto.randomUUID();
        status.textContent='ส่งข้อความเรียบร้อยแล้ว ทีมงานจะติดต่อกลับตามข้อมูลที่คุณให้ไว้';
        // Analytics failures must never turn a saved message into a visible failure.
        try { if (typeof window.fbq === 'function') window.fbq('track','Contact',{page_section:'Contact Form'}); } catch (_) {}
      } catch (error) {
        status.textContent=error.name==='TimeoutError' || error.name==='TypeError'
          ? 'ยังยืนยันการส่งไม่ได้ กรุณาลองอีกครั้ง ข้อมูลที่กรอกยังอยู่' : error.message || 'ส่งข้อความไม่สำเร็จ กรุณาลองอีกครั้ง';
      } finally {sending=false;button.disabled=false;}
    });
  });
})();
