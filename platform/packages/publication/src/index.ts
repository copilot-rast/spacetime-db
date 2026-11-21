import { publicationTables, publicationEnv, type PublicationSchema } from './schema';
import { defineNotify } from './notify';
import { defineNews } from './news';
import { defineFaq } from './faq';
import { seedPublication } from './seed';

export { publicationTables, publicationEnv, seedPublication };
export type { PublicationSchema };
export { sendNotification, type Message, type Delivered } from './deliver';
export { sanitizeHtml, markdownToHtml, htmlToText } from './html';
export { signJwt, rs256, parsePrivateKey } from './rsa';
export { nowUs as publicationNow } from './engine';

export function definePublication(spacetimedb: unknown) {
  const st = spacetimedb as PublicationSchema;
  return { ...defineNotify(st), ...defineNews(st), ...defineFaq(st) };
}
