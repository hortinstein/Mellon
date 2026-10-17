import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { E2E_DATA } from '../playwright.config.js';

export default function globalSetup() {
  rmSync(dirname(E2E_DATA), { recursive: true, force: true });
}
