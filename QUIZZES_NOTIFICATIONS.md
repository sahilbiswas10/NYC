# Quizzes and in-app notifications

Restart the backend after installing these changes, then refresh the browser. No new dependencies or manual database migration are required. MongoDB creates the new quiz, result, and notification collections when used.

## Create quizzes

1. Sign in as an admin or the instructor who owns the course.
2. Open the course editor.
3. Select **Lesson quiz** on a lesson or **Module test** on a module.
4. Add multiple-choice questions, answer options, the correct option number, and optional explanations.
5. Set the passing score (70% by default).
6. Select **Publish quiz**, then **Save quiz**. Leave Publish unchecked to save a draft.

Each question has one correct answer and 2–6 options. A published quiz contains 1–30 questions. Students can retry without an attempt limit; a later failed attempt does not erase a pass on the same revision. Grading happens on the server. Students receive question prompts and options, not the answer key.

### Import a quiz

Use **Download template** in the quiz editor, edit the JSON, then select **Import JSON**. Importing fills the editor without saving; review the questions, publish, and save. Files must be smaller than 90 KB.

```json
{
  "title": "Web fundamentals",
  "passingScore": 70,
  "questions": [
    {
      "prompt": "Which protocol secures HTTP traffic?",
      "options": ["TLS", "FTP", "SMTP"],
      "correctAnswer": 0,
      "explanation": "HTTPS uses TLS to protect the connection."
    }
  ]
}
```

`correctAnswer` starts at **0 in JSON**. The editor displays the first option as **1**.

## Student progression

- A lesson quiz does **not** block navigation to another lesson within an unlocked module.
- A published lesson quiz is required for that lesson's completion tick. Both its content and quiz must be completed.
- Students complete required lessons and pass their lesson quizzes before attempting the module test.
- Passing a published module test unlocks subsequent modules up to the next unpassed module test.
- The final module test also counts toward course completion and certificate eligibility.
- Locked modules show lesson titles but do not expose written lesson content, private media, or module notes. Access checks also run on the server.
- Admins and the course's instructor can preview content and edit quizzes without taking student attempts.
- Existing courses keep their current access until quizzes are published. Draft or missing quizzes do not create requirements. Add and publish a quiz for each lesson and a test for each module where you want these requirements.
- Media reused as a public course demo remains publicly playable; use separate media when lesson content should remain private.

Saving a quiz creates a new revision. Students must pass the new revision again. Editing a published module test can relock later modules; changing quiz requirements can also make a previously completed course incomplete. The editor explains this before saving. Deleting a quiz removes its attempts and passing requirement. Resetting or revoking an enrollment clears that student's quiz results alongside lesson progress.

## Notifications

Signed-in users have a bell leading to an inbox, with an unread count, pagination, mark-as-read, mark-all-as-read, and dismiss controls. Counts refresh about once a minute while the page is visible and when the window regains focus.

Notifications are generated for:

- Course detail updates and published quiz changes.
- Replies to a user's discussion thread.
- The student's quiz results.
- Announcements sent by an admin or the course's instructor.

To send an announcement, open the course editor and use **Course announcement** beneath the course details form. It goes to currently active or completed enrollments. This feature sends no emails or browser push notifications.

## Implementation checks

JavaScript syntax was checked for the changed feature files. Automated tests and browser/database workflows were not run for this feature change. Earlier audit results describe the earlier code, not this implementation.
