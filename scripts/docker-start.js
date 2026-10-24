// Container entrypoint: fix volume ownership, drop root, start the server.
import { dropPrivileges } from '../src/privileges.js';

dropPrivileges(process.env.MELLON_DATA || '/data/mellon.json');
const { start } = await import('../server.js');
start();
