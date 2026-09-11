/**
 * Ids that code outside the fixtures hardcodes, so the seed has to reproduce
 * them exactly. Grep an id to find what depends on it before changing one.
 *
 * Also the row type the fixture files are checked against.
 */

/** Rows accepted by `db.insert(table)`, with defaulted columns optional. */
export type Rows<T extends { $inferInsert: unknown }> = T['$inferInsert'][];

/** The principals the mock identity provider signs in as. */
export const ALICE = '11111111-1111-1111-1111-111111111111';
export const BOB = '22222222-2222-2222-2222-222222222222';
export const CAROL = '33333333-3333-3333-3333-333333333333';

/** Recorded as the author of rows the platform writes on its own behalf. */
export const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000001';

/** The organization the DB test suite inserts its own agents under. */
export const MOCK_ORG = '00000000-0000-0000-0000-000000000000';

/** The mock agents, and the sites they hold grants on. */
export const ZAPPY_AGENT = 'a0000000-0000-0000-0000-000000000001';
export const HELPER_AGENT = 'a0000000-0000-0000-0000-000000000002';
export const AUDI_SITE = '35b800c4-6010-4908-a724-f1512e2a2144';
export const DEMO_SITE_2 = '5da7f0d0-81d8-4e92-9a4b-a4cb07090768';
export const DEMO_SITE_3 = 'b56bdbfd-512c-4c1f-82e9-e774c2a8ec22';
