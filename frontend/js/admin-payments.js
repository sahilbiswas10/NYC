document.addEventListener('DOMContentLoaded', async () => {
    const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch (error) { return null; } })();
    if (!localStorage.getItem('token')) { window.location.replace('../login.html'); return; }
    if (user?.role !== 'admin') { window.location.replace(user?.role === 'instructor' ? '../instructor/dashboard.html' : '../student/dashboard.html'); return; }

    const table = document.getElementById('payments-table');
    const status = document.getElementById('payment-status');
    const errorBox = document.getElementById('payment-error');
    let page = 1;
    let totalPages = 1;
    const cell = (text) => {
        const td = document.createElement('td');
        td.className = 'py-4 px-3 border-b-2 border-black/10 dark:border-white/10 align-top';
        td.textContent = text;
        return td;
    };

    const loadPayments = async () => {
      try {
        const response = await window.api.admin.getPayments(page);
        const payments = Array.isArray(response.data) ? response.data : [];
        totalPages = response.pagination?.totalPages || 1;
        if (page > totalPages) { page = totalPages; return loadPayments(); }
        status.textContent = `${response.pagination?.total || payments.length} payment records · page ${page} of ${totalPages}`;
        document.getElementById('payments-page').textContent = `Page ${page} of ${totalPages}`;
        document.getElementById('payments-prev').disabled = page <= 1;
        document.getElementById('payments-next').disabled = page >= totalPages;
        table.replaceChildren();
        if (!payments.length) {
            const row = document.createElement('tr'); const empty = cell('No payment records found.'); empty.colSpan = 7; row.appendChild(empty); table.appendChild(row); return;
        }
        payments.forEach((payment) => {
            const amount = (Number(payment.amount) || 0) / 100;
            const created = new Date(payment.createdAt);
            const row = document.createElement('tr');
            row.append(
                cell(payment.student ? `${payment.student.name} · ${payment.student.email}` : 'Deleted account'),
                cell(payment.course?.title || 'Deleted course'),
                cell(new Intl.NumberFormat(undefined, { style: 'currency', currency: payment.currency || 'INR' }).format(amount)),
                cell(payment.status || 'unknown'),
                cell(payment.enrollmentGranted ? 'Granted' : 'Not granted'),
                cell(`Order: ${payment.razorpayOrderId || '—'}\nPayment: ${payment.razorpayPaymentId || '—'}`),
                cell(Number.isNaN(created.getTime()) ? 'Date unavailable' : created.toLocaleString())
            );
            table.appendChild(row);
        });
      } catch (error) {
        status.textContent = 'Payment history could not be loaded.';
        errorBox.textContent = error.message || 'Unable to load payment history.';
        errorBox.classList.remove('hidden');
        table.replaceChildren();
        const row = document.createElement('tr'); const failed = cell(`Unable to load payment history: ${error.message}`); failed.colSpan = 7; row.appendChild(failed); table.appendChild(row);
      }
    };
    document.getElementById('payments-prev').addEventListener('click', () => { if (page > 1) { page -= 1; loadPayments(); } });
    document.getElementById('payments-next').addEventListener('click', () => { if (page < totalPages) { page += 1; loadPayments(); } });
    await loadPayments();
});
