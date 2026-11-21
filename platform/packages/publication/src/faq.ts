import { t } from 'spacetimedb/server';
import { Translations, adminOrNull, audit, fail, requireAccount, requireRole } from '@stg/base';
import { pubRows, type PublicationSchema } from './schema';
import { markdownToHtml } from './html';
import { base, cleanText, langOf, pick } from './engine';

const FaqEntry = t.row('FaqEntry', { id: t.u64().primaryKey(), categoryId: t.u64(), question: Translations, answer: Translations, answerHtml: Translations, sort: t.i32() });
const FaqCategory = t.object('FaqCategoryLine', { id: t.u64(), key: t.string(), title: Translations });
const FaqLine = t.object('FaqLine', { id: t.u64(), categoryKey: t.string(), question: t.string(), answer: t.string(), answerHtml: t.string() });
const FaqList = t.object('FaqList', { lang: t.string(), categories: t.array(FaqCategory), items: t.array(FaqLine) });

export function defineFaq(st: PublicationSchema) {
  const faqEntries = st.view({ name: 'faq_entries', public: true }, t.array(FaqEntry), ctx =>
    [...ctx.db.faq.iter()]
      .filter(f => f.isActive && (!f.categoryId || ctx.db.category.id.find(f.categoryId)?.isActive))
      .map(f => ({ id: f.id, categoryId: f.categoryId, question: f.question, answer: f.answer, answerHtml: f.answerHtml, sort: f.sort }))
  );

  const adminFaqs = st.view({ name: 'admin_faqs', public: true }, t.array(pubRows.faq), ctx => (adminOrNull(ctx as any) ? [...ctx.db.faq.iter()] : []));

  const adminSaveFaq = st.reducer({ id: t.u64(), categoryId: t.u64(), question: Translations, answer: Translations, isActive: t.bool(), sort: t.i32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const old = a.id ? ctx.db.faq.id.find(a.id) : undefined;
    if (a.id && !old) fail('NOT_FOUND');
    if (a.categoryId) {
      const c = ctx.db.category.id.find(a.categoryId);
      if (!c) fail('CATEGORY_NOT_FOUND');
      if (c.keyType !== 'faq' && c.keyType !== 'general') fail('CATEGORY_KIND_MISMATCH');
    }
    const question = cleanText(ctx, a.question, 500, true, 'QUESTION_REQUIRED');
    const answer = cleanText(ctx, a.answer, 5000, true, 'ANSWER_REQUIRED');
    const row = { id: a.id, categoryId: a.categoryId, question, answer, answerHtml: answer.map(x => ({ lang: x.lang, text: markdownToHtml(x.text) })), isActive: a.isActive, sort: a.sort, createdAt: old?.createdAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
    const saved = old ? ctx.db.faq.id.update(row) : ctx.db.faq.insert({ ...row, id: 0n });
    audit(base(ctx), me.id, old ? 'faq.update' : 'faq.create', String(saved.id));
  });

  const adminDeleteFaq = st.reducer({ id: t.u64() }, (ctx, { id }) => {
    const me = requireRole(base(ctx), 'admin');
    if (!ctx.db.faq.id.find(id)) fail('NOT_FOUND');
    ctx.db.faq.id.delete(id);
    audit(base(ctx), me.id, 'faq.delete', String(id));
  });

  const faqList = st.procedure({ categoryKey: t.string(), q: t.string(), lang: t.string() }, FaqList, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const lang = langOf(tx, me.id, a.lang);
      const cats = [...tx.db.category.iter()].filter(c => (c.keyType === 'faq' || c.keyType === 'general') && c.isActive).sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1));
      const want = a.categoryKey ? cats.find(c => c.key === a.categoryKey) : undefined;
      const q = a.q.trim().toLowerCase().slice(0, 100);
      const items = [...tx.db.faq.iter()]
        .filter(f => f.isActive && (!f.categoryId || cats.some(c => c.id === f.categoryId)))
        .filter(f => !a.categoryKey || (want && f.categoryId === want.id))
        .filter(f => !q || [...f.question, ...f.answer].some(x => x.text.toLowerCase().includes(q)))
        .sort((x, y) => x.sort - y.sort || (x.id < y.id ? -1 : 1))
        .map(f => ({ id: f.id, categoryKey: cats.find(c => c.id === f.categoryId)?.key ?? '', question: pick(f.question, lang, tx), answer: pick(f.answer, lang, tx), answerHtml: pick(f.answerHtml, lang, tx) }));
      const used = new Set(items.map(i => i.categoryKey));
      return { lang, categories: cats.filter(c => used.has(c.key)).map(c => ({ id: c.id, key: c.key, title: c.title })), items };
    })
  );

  return {
    faqEntries,
    adminFaqs,
    adminSaveFaq,
    adminDeleteFaq,
    faqList,
  };
}
