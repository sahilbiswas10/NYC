document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);
    const kind = params.get('kind');
    const target = params.get('target');
    const course = params.get('course');
    const status = document.getElementById('quiz-editor-status');
    const form = document.getElementById('quiz-editor-form');
    const list = document.getElementById('quiz-questions-editor');
    let version = 0;
    let busy = false;
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    if (!localStorage.getItem('token')) { location.replace(`/login.html?returnTo=${encodeURIComponent(location.pathname + location.search)}`); return; }
    if (!['lesson', 'module'].includes(kind) || !/^[a-f\d]{24}$/i.test(target || '')) { status.textContent = 'Open the quiz editor from a lesson or module in the course editor.'; return; }
    if (/^[a-f\d]{24}$/i.test(course || '')) document.getElementById('quiz-editor-back').href = `/instructor/edit-course.html?id=${encodeURIComponent(course)}`;
    const endpoint = `/quizzes/${kind}/${target}`;
    const collect = () => [...list.querySelectorAll('fieldset')].map(field => ({
        prompt: field.querySelector('[data-prompt]').value,
        options: field.querySelector('[data-options]').value.split('\n').map(option => option.trim()),
        correctAnswer: Number(field.querySelector('[data-answer]').value) - 1,
        explanation: field.querySelector('[data-explanation]').value
    }));
    function render(questions) {
        list.innerHTML = questions.map((q, i) => `<fieldset class="quiz-question-editor"><legend>Question ${i + 1}</legend>
            <label>Question<textarea data-prompt required maxlength="2000">${escape(q.prompt)}</textarea></label>
            <label>Answer options — one per line (2–6)<textarea data-options required rows="4">${escape(q.options.join('\n'))}</textarea></label>
            <label>Correct option number (first option is 1)<input data-answer type="number" min="1" max="6" step="1" required value="${q.correctAnswer + 1}"></label>
            <label>Explanation after submission<textarea data-explanation maxlength="3000">${escape(q.explanation)}</textarea></label>
            <button type="button" data-remove="${i}" class="feature-button">Remove question</button></fieldset>`).join('');
    }
    function fill(quiz) {
        document.getElementById('quiz-title').value = quiz.title || (kind === 'module' ? 'Module test' : 'Lesson quiz');
        document.getElementById('quiz-passing-score').value = quiz.passingScore ?? 70;
        document.getElementById('quiz-enabled').checked = quiz.enabled === true;
        render(quiz.questions || []);
    }
    function setBusy(value) {
        busy = value;
        form.querySelectorAll('button, input, textarea').forEach(control => { control.disabled = value; });
    }
    document.getElementById('quiz-add-question').onclick = () => {
        const questions = collect();
        if (questions.length >= 30) { status.textContent = 'A quiz can contain up to 30 questions.'; return; }
        questions.push({ prompt: '', options: ['', '', '', ''], correctAnswer: 0, explanation: '' });
        render(questions);
        list.lastElementChild.querySelector('textarea').focus();
    };
    list.onclick = event => {
        const button = event.target.closest('[data-remove]');
        if (!button || busy) return;
        render(collect().filter((_q, index) => index !== Number(button.dataset.remove)));
    };
    document.getElementById('quiz-import').onchange = async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (file.size > 90000) throw new Error('Choose a JSON quiz smaller than 90 KB.');
            const quiz = JSON.parse(await file.text());
            if (!Array.isArray(quiz.questions) || quiz.questions.length > 30 || quiz.questions.some(q => !q || typeof q.prompt !== 'string' || !Array.isArray(q.options) || q.options.some(option => typeof option !== 'string') || !Number.isInteger(q.correctAnswer))) throw new Error('Invalid format. Download the template for an example.');
            fill({ ...quiz, enabled: false });
            status.textContent = 'Imported for review. Select Publish quiz and save when ready. Nothing has been saved yet.';
        } catch (error) { status.textContent = error.message; }
        event.target.value = '';
    };
    document.getElementById('quiz-template').onclick = () => {
        const template = { title: 'Your quiz title', passingScore: 70, enabled: false, questions: [{ prompt: 'Replace this with your question', options: ['First answer', 'Second answer', 'Third answer', 'Fourth answer'], correctAnswer: 0, explanation: 'Explain why the first answer is correct. correctAnswer uses zero-based numbering.' }] };
        const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'nyc-quiz-template.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    form.onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        const data = { title: document.getElementById('quiz-title').value, passingScore: Number(document.getElementById('quiz-passing-score').value), enabled: document.getElementById('quiz-enabled').checked, questions: collect(), expectedVersion: version };
        setBusy(true); status.textContent = 'Saving quiz…';
        try {
            const response = await window.apiCall(endpoint, { method: 'PUT', body: JSON.stringify(data) });
            version = response.data.version;
            document.getElementById('quiz-delete').classList.remove('hidden');
            status.textContent = data.enabled ? 'Quiz saved and published.' : 'Quiz saved as a draft.';
        } catch (error) { status.textContent = error.message; }
        finally { setBusy(false); }
    };
    document.getElementById('quiz-delete').onclick = async () => {
        if (busy || !await window.NYCUI.confirm('Delete this quiz and its attempts? Its passing requirement will also be removed.')) return;
        setBusy(true);
        try {
            await window.apiCall(endpoint, { method: 'DELETE', body: JSON.stringify({ expectedVersion: version }) });
            version = 0; fill({}); document.getElementById('quiz-delete').classList.add('hidden'); status.textContent = 'Quiz deleted.';
        } catch (error) { status.textContent = error.message; }
        finally { setBusy(false); }
    };
    try {
        const response = await window.apiCall(endpoint);
        if (!response.canManage) throw new Error('Only course managers can edit quizzes.');
        version = response.data?.version || 0;
        fill(response.data || {});
        form.classList.remove('hidden');
        document.getElementById('quiz-delete').classList.toggle('hidden', !version);
        status.textContent = version ? `Revision ${version} loaded.` : 'Add your first question or import a quiz.';
    } catch (error) { status.textContent = error.message; }
});
