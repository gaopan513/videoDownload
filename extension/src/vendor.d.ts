declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
declare module 'm3u8-parser' {
  export class Parser {
    manifest: any;
    push(text: string): void;
    end(): void;
  }
}
