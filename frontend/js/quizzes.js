(() => {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.mountQuiz = async (container, kind, target, course) => {
        if (!container) return;
        container.classList.remove('hidden');
        container.textContent = 'Loading quiz…';
        const endpoint = `/quizzes/${kind}/${encodeURIComponent(target)}`;
        const refresh = () => window.mountQuiz(container, kind, target, course);
        try {
            const response = await window.apiCall(endpoint);
            const quiz = response.data;
            if (response.canManage) {
                container.innerHTML = `<h2>${kind === 'module' ? 'Module test' : 'Lesson quiz'}</h2><p>${quiz ? `${escape(quiz.title)} · ${quiz.enabled ? 'Published' : 'Draft'} · ${quiz.questions.length} questions` : 'No quiz has been created yet.'}</p><a class="feature-button" href="quiz-editor.html?kind=${kind}&target=${encodeURIComponent(target)}&course=${encodeURIComponent(course)}">Edit quiz</a><p>Students take quizzes from their enrolled accounts.</p>`;
                return;
            }
            if (!quiz) { container.textContent = `No ${kind === 'module' ? 'module test' : 'lesson quiz'} has been published yet.`; return; }
            container.innerHTML = `<h2>${escape(quiz.title)}</h2><p>${quiz.passingScore}% to pass · Unlimited retries</p><p>${kind === 'lesson' ? 'You can move to the next lesson without passing this quiz. Pass it to complete this lesson.' : 'Pass this test to unlock the next module.'}</p><p class="quiz-result" role="status">${quiz.result?.passed ? `Passed · Best score: ${quiz.result.bestScore}%` : quiz.result ? `Best score: ${quiz.result.bestScore}% · Attempts: ${quiz.result.attempts}` : ''}</p>`;
            if (!quiz.canAttempt) {
                const reason = document.createElement('p'); reason.textContent = quiz.reason;
                const button = document.createElement('button'); button.className = 'feature-button'; button.textContent = 'Check requirements again'; button.addEventListener('click', refresh);
                container.append(reason, button); return;
            }
            const form = document.createElement('form');
            form.innerHTML = quiz.questions.map((q, i) => `<fieldset class="quiz-question"><legend>${i + 1}. ${escape(q.prompt)}</legend>${q.options.map((option, j) => `<label class="quiz-option"><input type="radio" name="q-${escape(q._id)}" value="${j}" required><span>${escape(option)}</span></label>`).join('')}<p data-feedback="${escape(q._id)}" class="quiz-feedback"></p></fieldset>`).join('') + '<button class="feature-button" type="submit">Submit answers</button>';
            container.appendChild(form);
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const button = form.querySelector('button'); button.disabled = true;
                const result = container.querySelector('.quiz-result');
                result.textContent = 'Saving your result…';
                try {
                    const values = new FormData(form);
                    const answers = Object.fromEntries(quiz.questions.map(q => [q._id, Number(values.get(`q-${q._id}`))]));
                    const { data } = await window.apiCall(`${endpoint}/attempts`, { method: 'POST', body: JSON.stringify({ version: quiz.version, answers }) });
                    result.textContent = `${data.score}% · ${data.correct}/${data.total} correct. ${data.attemptPassed ? 'Passed! Your result is saved.' : 'Try again when you are ready.'}${data.passed && !data.attemptPassed ? ' Your previous pass is retained.' : ''}`;
                    result.classList.toggle('is-passed', data.passed);
                    data.feedback.forEach(item => {
                        const element = form.querySelector(`[data-feedback="${item.question}"]`);
                        if (element) element.textContent = `${item.correct ? 'Correct.' : 'Incorrect.'} ${item.explanation || ''}`;
                    });
                    window.dispatchEvent(new CustomEvent('quiz:updated', { detail: { course, kind, target, passed: data.passed } }));
                    window.dispatchEvent(new Event('notifications:changed'));
                    if (kind === 'module' && data.passed && !container.querySelector('[data-continue-course]')) {
                        const link = document.createElement('a'); link.className = 'feature-button'; link.dataset.continueCourse = ''; link.textContent = 'Continue course'; link.href = `course.html?course=${encodeURIComponent(course)}&view=curriculum`; container.appendChild(link);
                    }
                } catch (error) { result.textContent = error.message; }
                finally { button.disabled = false; button.textContent = 'Submit answers again'; }
            });
        } catch (error) {
            container.textContent = error.message;
            const retry = document.createElement('button'); retry.className = 'feature-button'; retry.textContent = 'Retry'; retry.addEventListener('click', refresh); container.appendChild(retry);
        }
    };
})();
