import { schema } from 'spacetimedb/server';
import { platformTables, platformEnv } from './platform-tables';
import { gameTables, gameEnv } from './game/tables';

const spacetimedb = schema({ ...platformTables, ...gameTables }, { env: { ...platformEnv, ...gameEnv } });
export default spacetimedb;
