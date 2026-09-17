import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { JevBrowser } from '@tontoko/jev-browser';

// Explicit live-API example. The page contains only synthetic data.
test('Jev chooses actions; Playwright asserts the outcome', async ({ page }) => {
  const browser = new JevBrowser({ page });
  try {
    await page.setContent(`<label>Email<input type="email"></label><button>Save</button><h1>Unsaved</h1>`);
    await page.getByRole('button').evaluate(button => {
      button.addEventListener('click', () => { document.querySelector('h1')!.textContent = 'Saved'; });
    });
    await browser.act('Fill the Email field with email', { values: { email: 'synthetic@example.invalid' } });
    await expect(page.getByRole('textbox')).toHaveValue('synthetic@example.invalid');
    await browser.act('Click Save');
    await expect(page.getByRole('heading')).toHaveText('Saved');
    const { data, evidence } = await browser.extract('Read the status heading', z.object({ status: z.string() }), { scope: 'h1' });
    expect(data.status).toBe('Saved');
    expect(evidence.status!.text).toBe('Saved');
  } finally {
    await browser.close(); // The Playwright fixture retains ownership of Page.
  }
});
