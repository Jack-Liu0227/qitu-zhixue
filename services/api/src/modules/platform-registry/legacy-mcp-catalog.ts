/** Restored definitions from the pre-knowledge-center admin UI.
 * These are display manifests, not verified MCP discovery or executable tools.
 */
interface Parameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string | number | boolean;
}
export interface LegacyMcpManifest {
  id: string;
  name: string;
  description: string;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
}
const p = (
  name: string,
  type: string,
  required: boolean,
  description: string,
  defaultValue?: Parameter['defaultValue'],
): Parameter => ({
  name,
  type,
  required,
  description,
  ...(defaultValue === undefined ? {} : { defaultValue }),
});
function tool(name: string, description: string, params: Parameter[]) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      'x-qitu-definition-source': 'legacy-admin-ui-v1',
      properties: Object.fromEntries(
        params.map(({ name: key, type, description: detail, defaultValue }) => {
          const schema: Record<string, unknown> = {
            type: type === 'string[]' ? 'array' : type,
            description: detail,
          };
          if (type === 'string[]') schema.items = { type: 'string' };
          if (defaultValue !== undefined) {
            // The original viewport tooltip was a string despite its object type.
            // Keep that hint as metadata rather than declaring an invalid object default.
            schema[
              type === 'object' && typeof defaultValue !== 'object'
                ? 'x-original-default-value'
                : 'default'
            ] = defaultValue;
          }
          return [key, schema];
        }),
      ),
      required: params.filter((parameter) => parameter.required).map((parameter) => parameter.name),
    },
  };
}
export const LEGACY_MCP_MANIFESTS: readonly LegacyMcpManifest[] = [
  {
    id: 'mcp-grok-search',
    name: 'groksearch',
    description: 'Grok 深度搜索、网页抓取、知识扩展与引用提取。',
    tools: [
      tool('grok_web_search', '搜索关键词、学术概念或事实', [
        p('query', 'string', true, '搜索关键词、学术概念或事实提问'),
        p('max_results', 'number', false, '返回的最大网页摘要条数 (1-20)', 5),
        p('include_domains', 'string[]', false, '限定检索的目标域名白名单列表'),
      ]),
      tool('fetch_page_markdown', '抓取网页 Markdown 正文', [
        p('url', 'string', true, '目标网页完整 URL 地址'),
        p('extract_main_content', 'boolean', false, '是否剔除页眉页脚与广告提取正文', true),
      ]),
      tool('knowledge_crawl', '按主题抓取和扩展知识', [
        p('topic', 'string', true, '知识图谱抓取与扩展的主题关键词'),
        p('depth', 'number', false, '拓扑层级深度 (1-4)', 2),
      ]),
      tool('citation_extract', '提取和格式化引用', [
        p('text', 'string', true, '待溯源引用的学术或概念文本段落'),
        p('style', 'string', false, '参考文献引文格式规范', 'GB/T 7714'),
      ]),
    ],
  },
  {
    id: 'mcp-chrome-devtools',
    name: 'chrome-devtools',
    description: 'Chrome 浏览器控制、截图与控制台日志。',
    tools: [
      tool('launch_browser', '启动浏览器', [
        p('headless', 'boolean', false, '是否以无头后台模式运行 Chromium', true),
        p('viewport', 'object', false, '初始视口宽度与高度配置', '1280x800'),
      ]),
      tool('navigate_page', '跳转页面', [
        p('url', 'string', true, '跳转的目标页面地址 (需含 http/https 协议头)'),
        p('timeout_ms', 'number', false, '页面加载超时毫秒数', 30000),
      ]),
      tool('click_element', '点击页面元素', [
        p('selector', 'string', true, '目标元素的 CSS 选择器或 XPath 路径'),
        p('wait_for_navigation', 'boolean', false, '点击后是否等待页面导航完成', false),
      ]),
      tool('take_screenshot', '截取页面图像', [
        p('full_page', 'boolean', false, '是否截取滚动完整长图', false),
        p('format', 'string', false, '截图格式 (png / jpeg / webp)', 'png'),
      ]),
      tool('capture_console', '读取浏览器控制台日志', [
        p('level', 'string', false, '日志捕获级别 (error / warn / all)', 'all'),
        p('limit', 'number', false, '最大捕获日志行数', 100),
      ]),
    ],
  },
  {
    id: 'mcp-aionui-browser',
    name: 'aionui-browser',
    description: 'AionUI 浏览器标签页、DOM 读取与交互。',
    tools: [
      tool('browser_tab_open', '打开浏览器标签页', [
        p('url', 'string', true, '新建标签页打开的目标网址'),
      ]),
      tool('read_dom', '读取页面 DOM', [
        p('selector', 'string', false, '读取 DOM 树的根节点选择器', 'body'),
      ]),
      tool('execute_js_action', '执行浏览器交互脚本', [
        p('script', 'string', true, '在浏览器上下文中安全执行的 JavaScript 代码片段'),
      ]),
      tool('snapshot_viewport', '截取视口或局部节点', [
        p('selector', 'string', false, '指定截取的局部 DOM 节点选择器'),
      ]),
    ],
  },
  {
    id: 'mcp-fetch',
    name: 'fetch',
    description: '网页 HTML、Markdown 与链接提取。',
    tools: [
      tool('fetch_html', '获取网页 HTML', [p('url', 'string', true, '页面 HTTP 请求目标 URL')]),
      tool('fetch_markdown', '获取网页 Markdown', [
        p('url', 'string', true, '目标页面 URL，自动抓取并转换为纯净 Markdown'),
      ]),
      tool('extract_links', '提取页面链接', [
        p('url', 'string', true, '目标页面 URL，提取所有外链与站内锚点'),
      ]),
    ],
  },
];
export const legacyMcpManifest = (id: string) =>
  LEGACY_MCP_MANIFESTS.find((manifest) => manifest.id === id);
