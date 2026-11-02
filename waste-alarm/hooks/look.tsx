// The Session pane look (session-panel): status glyphs in theme colors and bordered cards.
// A hooks module imports only files of its own plugin, so each mod has a copy. Keep the copies identical.
import type { Elements, RenderChildren, ThemeKey } from 'claude-code'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
export type Mark = 'done' | 'active' | 'idle' | 'fail' | 'warn'

const GLYPH: Record<Mark, string> = { done: '✓', active: '●', idle: '○', fail: '✗', warn: '●' }
const COLOR: Record<Mark, ThemeKey> = { done: 'suggestion', active: 'claude', idle: 'inactive', fail: 'error', warn: 'warning' }

// A status glyph in its theme color. Nest it in the label's Text, so the label stays one Text.
export const mark = ({ Text }: Kit, kind: Mark) => <Text color={COLOR[kind]}>{GLYPH[kind]}</Text>

// A bordered card with a bold title. With `fold`, the title opens and closes the body.
export const card = (
  { Box, Text, Button }: Kit,
  id: string,
  title: string,
  body: RenderChildren,
  fold?: { isShut: boolean; onToggle: () => unknown },
) => (
  <Box key={`card-${id}`} flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginBottom={1}>
    {fold ? (
      <Button key={`toggle-${id}`} plain onPress={fold.onToggle}>
        <Text bold>{title}</Text> <Text dimColor>{fold.isShut ? '›' : '⌄'}</Text>
      </Button>
    ) : (
      <Text bold>{title}</Text>
    )}
    {!fold?.isShut && <Box flexDirection="column" marginTop={1}>{body}</Box>}
  </Box>
)
