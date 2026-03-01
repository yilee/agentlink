// ── AskUserQuestion interaction ───────────────────────────────────────────────

export function selectQuestionOption(msg, qIndex, optLabel) {
  if (msg.answered) return;
  const q = msg.questions[qIndex];
  if (!q) return;
  if (q.multiSelect) {
    const sel = msg.selectedAnswers[qIndex] || [];
    const idx = sel.indexOf(optLabel);
    if (idx >= 0) sel.splice(idx, 1);
    else sel.push(optLabel);
    msg.selectedAnswers[qIndex] = [...sel];
  } else {
    msg.selectedAnswers[qIndex] = optLabel;
    msg.customTexts[qIndex] = '';
  }
}

export function submitQuestionAnswer(msg, wsSend) {
  if (msg.answered) return;
  const answers = {};
  for (let i = 0; i < msg.questions.length; i++) {
    const q = msg.questions[i];
    const key = q.question || String(i);
    const custom = (msg.customTexts[i] || '').trim();
    if (custom) {
      answers[key] = custom;
    } else {
      const sel = msg.selectedAnswers[i];
      if (Array.isArray(sel) && sel.length > 0) {
        answers[key] = sel.join(', ');
      } else if (sel != null) {
        answers[key] = sel;
      }
    }
  }
  msg.answered = true;
  wsSend({ type: 'ask_user_answer', requestId: msg.requestId, answers });
}

export function hasQuestionAnswer(msg) {
  for (let i = 0; i < msg.questions.length; i++) {
    const sel = msg.selectedAnswers[i];
    const custom = (msg.customTexts[i] || '').trim();
    if (custom || (Array.isArray(sel) ? sel.length > 0 : sel != null)) return true;
  }
  return false;
}

export function getQuestionResponseSummary(msg) {
  const parts = [];
  for (let i = 0; i < msg.questions.length; i++) {
    const custom = (msg.customTexts[i] || '').trim();
    if (custom) {
      parts.push(custom);
    } else {
      const sel = msg.selectedAnswers[i];
      if (Array.isArray(sel)) parts.push(sel.join(', '));
      else if (sel) parts.push(sel);
    }
  }
  return parts.join(' | ');
}
