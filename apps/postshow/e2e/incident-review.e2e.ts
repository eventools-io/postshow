// The product spine in a real browser: sign in, read the incident list, open a
// dossier and its evidence requirements, and reach the approval surface.
//
// Component tests run in happy-dom and never render in an engine, so nothing
// else in this repository proves the routed, lazily loaded app actually boots
// for a signed-in reviewer.

import { expect, test, type Page } from '@playwright/test';
import { installSupabaseStack } from './support/stack';
import {
  GROUNDED_INCIDENT,
  GROUNDED_INCIDENT_ID,
  INBOX_ITEM,
  SIGN_IN_EMAIL,
  SIGN_IN_PASSWORD,
  THIN_INCIDENT,
  THIN_INCIDENT_ID,
  WORKSPACE,
} from './support/workspace';

const APPROVE_BUTTON = `Review ${INBOX_ITEM.action_label.toLowerCase()}`;

async function signIn(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(SIGN_IN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(SIGN_IN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/inbox');
}

test.describe('incident review', () => {
  test('a reviewer signs in and walks from the inbox to a grounded dossier', async ({ page }) => {
    const traffic = await installSupabaseStack(page);
    await signIn(page);

    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: INBOX_ITEM.title })).toBeVisible();
    await expect(page.getByText(WORKSPACE.name).first()).toBeVisible();

    await page.getByRole('link', { name: 'Incidents' }).first().click();
    await expect(page).toHaveURL(/\/incidents$/);
    await expect(page.getByRole('heading', { name: 'Customer incidents' })).toBeVisible();
    await expect(page.getByRole('heading', { name: GROUNDED_INCIDENT.title })).toBeVisible();
    await expect(page.getByRole('heading', { name: THIN_INCIDENT.title })).toBeVisible();

    await page.getByRole('link', { name: new RegExp(GROUNDED_INCIDENT.title) }).click();
    await expect(page).toHaveURL(new RegExp(`/incidents/${GROUNDED_INCIDENT_ID}$`));

    await expect(
      page.getByRole('heading', { name: GROUNDED_INCIDENT.title, level: 1 })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'act', exact: true, level: 2 })).toBeVisible();
    for (const requirement of [
      'Behavior evidence',
      'Account identity',
      'Technical failure evidence',
      'Code context',
      'Recovery check',
    ]) {
      await expect(page.getByText(requirement, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('open evidence gaps')).toHaveCount(0);
    await expect(page.getByText('Northwind Systems')).toBeVisible();
    await expect(page.getByText('4 grounded replays')).toBeVisible();

    // The dossier hands the decision back to the browser: the CLI is never the
    // surface that executes an intervention.
    await page.getByRole('link', { name: 'Review in inbox' }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByRole('button', { name: APPROVE_BUTTON })).toBeVisible();

    expect(traffic.blocked, `the app reached something the fixture refused`).toEqual([]);
  });

  test('a thin dossier shows its gaps and refuses to offer replays', async ({ page }) => {
    // No PostHog connection: behavior evidence exists but cannot be opened,
    // which is the degraded-provider shape a reviewer has to be able to see.
    await installSupabaseStack(page, { posthogConnected: false });
    await signIn(page);

    await page.goto(`/incidents/${THIN_INCIDENT_ID}`);
    await expect(page.getByRole('heading', { name: THIN_INCIDENT.title, level: 1 })).toBeVisible();
    await expect(page.getByText('decision: gather more')).toBeVisible();
    await expect(page.getByText('open evidence gaps')).toBeVisible();
    await expect(page.getByText('sampled run coverage')).toBeVisible();
    await expect(
      page.getByText('Connect the matching PostHog project to open replays.')
    ).toBeVisible();
    await expect(
      page.getByText('No intervention has cleared the review threshold yet.')
    ).toBeVisible();
  });

  test('the approval surface locks its controls when permissions cannot be verified', async ({
    page,
  }) => {
    await installSupabaseStack(page, { permissions: 'fail' });
    await signIn(page);

    await expect(page.getByRole('heading', { name: INBOX_ITEM.title })).toBeVisible();
    await expect(
      page.getByText('Inbox permissions could not be verified. Draft controls remain locked.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry permission check' })).toBeVisible();
    await expect(page.getByRole('button', { name: APPROVE_BUTTON })).toHaveCount(0);
    await expect(page.getByText('read-only')).toBeVisible();
  });
});
