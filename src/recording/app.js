const $ = id => document.getElementById(id);
let busy = false;
function text(tag, value, className) { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; }
function render(state) {
  $('messages').replaceChildren(...state.messages.map(m => {
    const bubble = text('div', '', `bubble ${m.role}`);
    bubble.append(text('span', m.role === 'you' ? 'Riya · fictional' : 'Mentor · offline rules', 'speaker'), document.createTextNode(m.text));
    return bubble;
  }));
  $('messages').scrollTop = $('messages').scrollHeight;
  $('memory').textContent = `Memory ${state.memoryOn ? 'on' : 'off'} · ${state.memories.length} summaries`;
  $('why').textContent = state.why;
  $('scores').textContent = `${state.scores.length} saved score${state.scores.length === 1 ? '' : 's'} · ${state.attempts.length} recorded attempts` + (state.scores.length ? '\n' + state.scores.map(q => `${q.correct}/${q.total} · mastery ${q.masteryBefore} → ${q.masteryAfter}`).join('\n') : '');
  $('topics').replaceChildren(...state.topics.map(t => { const row = text('div', '', 'topic'); row.append(text('span', t.name), text('strong', `${Math.round(t.mastery * 1000) / 10}%`)); return row; }));
}
async function request(route, body = {}) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  $('status').className = '';
  $('status').textContent = 'Working through the local conversation…';
  try {
    const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || 'Local request failed');
    render(state);
    if (route === '/reset') window.scrollTo(0, 0);
    if (route === '/turn') $('message').value = '';
    $('status').textContent = 'Ready · offline rules · fictional scratch data';
  } catch (error) {
    $('status').className = 'error';
    $('status').textContent = error.message === 'Failed to fetch' ? 'Local server unavailable. Start npm run record, then reload.' : error.message;
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}
$('form').addEventListener('submit', event => { event.preventDefault(); if ($('message').value.trim()) request('/turn', { message: $('message').value }); });
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('form').requestSubmit(); } });
$('reset').addEventListener('click', () => request('/reset'));
document.querySelectorAll('[data-message]').forEach(b => b.addEventListener('click', () => request('/turn', { message: b.dataset.message })));
request('/session');
