// Login-form automation shared by the `login` command and its test harness.
// Kept transport-agnostic: the returned function is serialised and executed in
// the page via opencli's page.evaluate().
// Runs in the page. Handles whichever step of the login flow is on screen:
//   - password field visible  → fill password (+ username if on same page), submit
//   - only an email field     → fill email, click Next
// Safe to call repeatedly; the Node side rate-limits per URL.
export function loginStepJs() {
  return ({ username, password }) => {
    const visible = (el) => {
      if (!el || el.disabled || el.readOnly) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const textOf = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    const setNativeValue = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const trySubmit = (anchor) => {
      const scope = anchor?.closest('form') || document;
      const cands = [...scope.querySelectorAll('button, input[type=submit], [role=button], a')].filter(visible);
      const byText = cands.find((el) => /^(next|continue|log ?in|sign ?in|submit|valider|suivant)$/i.test(textOf(el)));
      const btn = byText || cands.find((el) => el.type === 'submit') || (scope !== document ? scope.querySelector('button') : null);
      if (btn && visible(btn)) {
        btn.click();
        return `button:${textOf(btn).slice(0, 14)}`;
      }
      const form = anchor?.closest('form') || document.querySelector('form');
      if (form) {
        form.requestSubmit();
        return 'requestSubmit';
      }
      return 'no-submit';
    };

    const pwFields = [...document.querySelectorAll('input[type=password]')].filter(visible);
    const typed = [...document.querySelectorAll('input')].filter(visible)
      .filter((el) => ['email', 'text', 'tel'].includes(el.type))
      .filter((el) => el.type === 'email'
        || /user|email|login|identif|account/i.test(`${el.name} ${el.id} ${el.autocomplete} ${el.placeholder}`));

    if (pwFields.length > 0) {
      setNativeValue(pwFields[0], password);
      const user = typed[0];
      if (user && !user.value) setNativeValue(user, username);
      return { found: 'password-submitted', via: trySubmit(pwFields[0]), url: location.href };
    }
    if (typed.length > 0) {
      const user = typed[0];
      if (user.value !== username) setNativeValue(user, username);
      return { found: 'email-submitted', via: trySubmit(user), url: location.href };
    }
    return { found: 'no-form', url: location.href };
  };
}

