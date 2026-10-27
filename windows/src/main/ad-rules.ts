import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { Session } from 'electron';
import { fetchAt, readLimited } from './resolver';

export const AD_RULES_URL = 'https://raw.githubusercontent.com/tickmao/ADrules/master/AdRules.txt';
const MAX_RULE_BYTES = 8 * 1024 * 1024;

function parseRules(text: string) {
  if (!text.startsWith('[Adblock Plus 2.0]') || text.length < 30) throw new Error('广告规则格式无效');
  return ElectronBlocker.parse(text);
}

export class SearchAdRules {
  private blocker?: ElectronBlocker;
  private update?: Promise<void>;
  private initial?: Promise<void>;

  constructor(private readonly file: string, private readonly downloadSession: Session, private readonly searchSession: Session, private readonly url = AD_RULES_URL) {}

  start() {
    this.initial ??= this.loadAndUpdate();
    return this.initial;
  }

  private async loadAndUpdate() {
    try {
      const cached = await readFile(this.file, 'utf8');
      this.apply(parseRules(cached));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('广告规则缓存不可用', error);
    }
    this.update = this.refresh().catch(error => { console.error('广告规则更新失败，继续使用现有规则', error); });
    if (!this.blocker) await this.update;
  }

  private apply(next: ElectronBlocker) {
    const previous = this.blocker;
    if (previous) previous.disableBlockingInSession(this.searchSession);
    try {
      next.enableBlockingInSession(this.searchSession);
      this.blocker = next;
    } catch (error) {
      if (previous) previous.enableBlockingInSession(this.searchSession);
      throw error;
    }
  }

  private async refresh() {
    const signal = AbortSignal.timeout(20000);
    const response = await fetchAt(this.downloadSession, this.url, { signal });
    if (!response.ok) throw new Error(`广告规则返回 HTTP ${response.status}`);
    const text = await readLimited(response, MAX_RULE_BYTES, signal);
    const next = parseRules(text);
    const temporary = this.file + '.new';
    try {
      await writeFile(temporary, text, 'utf8');
      await rename(temporary, this.file);
      this.apply(next);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  get loaded() { return !!this.blocker; }
}
