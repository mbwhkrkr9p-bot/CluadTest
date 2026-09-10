// Top-center game HUD: objective, progress ribbon, counts, collision status, design brief, Review.
export function createHud(studio, { toasts }) {
  const $ = (id) => document.getElementById(id);
  const hud = $('hud');
  const objective = $('hud-objective');
  const progress = $('hud-progress');
  const count = $('hud-count');
  const score = $('hud-score');
  const collision = $('hud-collision');
  const briefToggle = $('hud-brief-toggle');
  const brief = $('hud-brief');
  const review = $('btn-review');
  let lastInfo = null;

  function renderProgress(info) {
    progress.innerHTML = '';
    info.steps.forEach((step, i) => {
      const dot = document.createElement('span');
      dot.className = 'hud-dot';
      if (step.done) dot.classList.add('is-done');
      if (info.currentStep && info.currentStep.id === step.id) dot.classList.add('is-current');
      dot.title = step.title;
      dot.setAttribute('aria-label', `${i + 1}. ${step.title}${step.done ? ' (done)' : ''}`);
      dot.textContent = step.done ? '✓' : String(i + 1);
      progress.appendChild(dot);
    });
  }

  function renderBrief(info) {
    brief.innerHTML = '';
    for (const step of info.steps) {
      const li = document.createElement('li');
      li.className = step.done ? 'is-done' : (info.currentStep && info.currentStep.id === step.id ? 'is-current' : '');
      const title = document.createElement('strong');
      title.textContent = step.title;
      const text = document.createElement('span');
      text.textContent = ` — ${step.objective}`;
      li.append(title, text);
      if (step.hint && !step.done) {
        const hint = document.createElement('small');
        hint.textContent = step.hint;
        li.appendChild(hint);
      }
      brief.appendChild(li);
    }
  }

  function render(info) {
    if (!info) return;
    lastInfo = info;
    objective.textContent = info.objectiveText;
    objective.classList.toggle('is-warning', info.collisionCount > 0);
    renderProgress(info);
    count.textContent = `${info.fixtureCount} fixture${info.fixtureCount === 1 ? '' : 's'}`;
    score.textContent = `${info.percent}% complete`;
    const blocking = info.collisionCount;
    const outsideOnly = info.overlapCount === 0 && info.outsideCount > 0;
    collision.hidden = false; // the HUD always reports collision status, calm or otherwise
    collision.classList.toggle('is-warning', blocking > 0);
    if (blocking === 0) collision.textContent = 'No overlaps';
    else if (outsideOnly) collision.textContent = `${blocking} outside the room`;
    else collision.textContent = `${info.overlapCount} overlap${info.overlapCount === 1 ? '' : 's'}${info.outsideCount ? ` · ${info.outsideCount} outside` : ''}`;
    review.hidden = !info.coreComplete;
    review.disabled = !info.coreComplete;
    renderBrief(info);
  }

  briefToggle.addEventListener('click', () => {
    const open = brief.hidden;
    brief.hidden = !open;
    briefToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  review.addEventListener('click', () => {
    if (studio.isReviewing()) { studio.cancelReview(); return; }
    studio.startReview();
  });

  studio.on('game', ({ info, fresh }) => {
    render(info);
    if (!fresh.length) return;
    const titles = fresh.map((id) => info.steps.find((s) => s.id === id)?.title).filter(Boolean);
    if (titles.length === 1) toasts.milestone(`${titles[0]} complete`, info.complete ? 'Layout complete!' : undefined);
    else toasts.milestone(`${titles.length} steps complete`, `${titles.join(', ')}${info.complete ? ' — layout complete!' : ''}`);
  });
  studio.on('review', ({ active, completed }) => {
    review.textContent = active ? 'Stop review' : 'Review';
    review.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (completed) toasts.show('Review complete — nice work.', { kind: 'success', duration: 2600 });
  });
  studio.on('mode', (mode) => { hud.hidden = mode === 'finish'; });

  render(studio.game());
  brief.hidden = true;
  briefToggle.setAttribute('aria-expanded', 'false');
  return { render, info: () => lastInfo };
}
