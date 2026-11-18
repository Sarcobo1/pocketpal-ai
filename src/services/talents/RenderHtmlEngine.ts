import {TalentEngine, TalentResult, ToolDefinition, SystemPromptContext} from './types';

/**
 * Engine for the `render_html` talent.
 *
 * Arguments:
 *   - `html` (string, required): the HTML document (or fragment) to render.
 *   - `title` (string, optional): a short label shown above the preview.
 *
 * Security model: this engine is a pure pass-through — sanitization is the
 * WebView wrapper's job. See HtmlPreviewBubble for the actual envelope:
 * strict CSP (default-src 'none', no network/external fetch), but JavaScript
 * IS enabled with 'unsafe-inline' + 'unsafe-eval' for interactive HTML/games.
 * Navigation is pinned to about:blank; no native bridge surface.
 */
export class RenderHtmlEngine implements TalentEngine {
  readonly name = 'render_html';
  readonly recommendedContextTokens = 4096;

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const html = typeof args.html === 'string' ? args.html : '';
    const title = typeof args.title === 'string' ? args.title : undefined;

    if (!html) {
      return {
        type: 'error',
        summary: 'render_html: missing or empty "html" argument',
        errorMessage:
          'html argument is required and must be a non-empty string',
      };
    }

    return {
      type: 'html',
      html,
      title,
      summary: `[render_html SUCCESS] The html has been rendered into a preview above, and the user can see and toggle to see the code. 
Reply with at most one short sentence what you build`,
    };
  }

  systemPromptFragment(_ctx: SystemPromptContext): string {
    return (
      'CANVAS / HTML PREVIEW: You have the render_html tool. ' +
      'When the user asks to BUILD, CREATE, DESIGN, or PREVIEW a website, landing page, HTML component, game, form, or any visual content — ' +
      'write complete, self-contained HTML+CSS+JavaScript and call render_html immediately. ' +
      'NEVER search the web to build HTML. NEVER just print the code without calling render_html. ' +
      'The Canvas renders inside the app with full JS support.'
    );
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'render_html',
        description:
          'Render an HTML document inline as a visual interactive Canvas preview in the chat. ALWAYS use this tool when the user asks to build, create, design, or preview a website, landing page, HTML page, UI component, game, or any visual/interactive content. Write complete self-contained HTML+CSS+JS and call this tool immediately — do NOT search the web for it.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short label shown above the preview.',
            },
            html: {
              type: 'string',
              description:
                'Complete, self-contained HTML document or fragment to render.',
            },
          },
          required: ['html'],
        },
      },
    };
  }
}
