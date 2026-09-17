import { strict as assert } from 'node:assert';
import { z } from 'zod';
import { JevBrowser } from '@tontoko/jev-browser';

const browser = await JevBrowser.launch();
try {
  await browser.page.setContent(`<label>Email<input type="email"></label><button>Save</button><h1>Unsaved</h1>`);
  await browser.page.getByRole('button').evaluate(button => {
    button.addEventListener('click', () => { document.querySelector('h1').textContent = 'Saved'; });
  });
  await browser.act('Fill the Email field with email', { values: { email: 'synthetic@example.invalid' } });
  await browser.act('Click Save');
  const result = await browser.extract('Read the status heading', z.object({ status: z.string() }), { scope: 'h1' });
  assert.equal(result.data.status, 'Saved');
  console.log(JSON.stringify({ data: result.data, evidence: result.evidence }, null, 2));
} finally {
  await browser.close();
}
