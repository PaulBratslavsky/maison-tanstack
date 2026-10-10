import { config } from '../lib/config';
import { COPY } from '../lib/copy';
import { lineChatUrl, lineChatWords } from '../lib/line-chat';
import { useMaison } from './maison-provider';

/**
 * "Chat with Maison on LINE": a plain link to LINE's chat with Maison's Official Account (lineChatUrl), which LINE
 * opens itself, as the chat for a friend and the add-friend screen for anyone else. It's secondary, an outline in ink,
 * never louder than "Book a visit", and it sits in the page's flow, inside LINE's safe area. With `line`, My visits' line
 * above it says where the confirmation arrives. For a customer LINE says hasn't added Maison yet (friendFlag false),
 * both ask them to add it. Without VITE_LINE_OA_ID there's nothing at all.
 */
export function LineChat({ line = false, className = '' }: { line?: boolean; className?: string }) {
  const { locale, friendFlag } = useMaison();
  const url = lineChatUrl(config.lineOaId);
  if (!url) return null;
  const words = lineChatWords(COPY[locale].lineChat, friendFlag);
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {line && <p className="text-body text-graphite">{words.line}</p>}
      <a href={url} data-testid="line-chat" className="btn-secondary w-full">
        {words.button}
      </a>
    </div>
  );
}
