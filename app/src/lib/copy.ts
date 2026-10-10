export const COPY = {
  ja: {
    // The Home page's built-in text (lib/home-page.ts): the same words as Strapi's starting text for the Home page
    // single type. Home shows Strapi's published text, and these when Strapi can't give it.
    home: {
      eyebrow: '心を込めて選ぶ、贈り物',
      headline: 'ふさわしい一品を。店頭で、お手に取って。',
      ctaLabel: 'コンシェルジュに相談する',
    },
    collections: 'コレクション',
    pieces: (n: number) => `${n}点`,
    myVisits: 'ご来店予約',
    // The header's link back to Home, after its ‹ (components/header.tsx).
    homeNav: 'トップ',
    agentView: 'エージェントビュー',
    agentViewEmpty: 'この画面のツール呼び出しはまだありません。',
    language: '言語',
    signingIn: 'LINEでサインインしています…',
    signInFailed: 'サインインできませんでした',
    // LINE mode, outside the LINE app: the "Open in LINE" page (components/open-in-line.tsx).
    openInLine: {
      title: 'LINEでMaisonを開く',
      body: 'MaisonはLINEの中で動きます。LINEのQRコードリーダーでこのコードを読み取ってください（LINEの検索バーの横にあるQRアイコン）。',
      // On a phone (lib/open-in-line.ts): the code is on its own screen, so the button leads.
      bodyPhone: 'MaisonはLINEの中で動きます。下の「LINEで開く」をタップしてください。',
      button: 'LINEで開く',
      hint: 'SafariやChromeで開いてしまう場合は、LINEの［設定］→［LINEラボ］で「リンクをデフォルトのブラウザで開く」をオフにしてください。',
      alt: 'LINEでMaisonを開くQRコード',
    },
    backHome: 'トップへ戻る',
    chooseDate: '日付をお選びください。',
    dateTooSoon: '明日以降の日付をお選びください。',
    loading: '読み込み中…',
    retry: 'もう一度',
    // A product's details list: its size, personalization, and the boutiques that have it.
    size: 'サイズ',
    inStockAt: '在庫のある店舗',
    outOfStock: '在庫なし',
    personalization: 'パーソナライズ',
    // The catalog's personalization kinds, by slug (view_product returns slugs).
    personalizationKinds: {
      'initials-hot-stamp': 'イニシャルの箔押し',
      'hand-painted-stripes': 'ハンドペイントのストライプ',
      'monogram-color': 'お好みの色のモノグラム',
    },
    leadDays: (n: number) => `お届けまで約${n}日`,
    bookVisit: '来店を予約',
    // Under a product's details list: it opens the concierge with that piece in context (/concierge?product=<slug>).
    askAboutPiece: 'この商品について質問する',
    boutique: 'ブティック',
    // After a boutique's name in the booking sheet, whose radio is disabled: it doesn't have the piece.
    notInStock: '在庫なし',
    date: '日付',
    time: '時間',
    note: 'ブティックへのメッセージ',
    notePlaceholder: 'どなたへの贈り物ですか？（任意）',
    request: 'リクエストを送る',
    // Under the booking sheet's button.
    confirmsOnLine: 'ブティックからLINEで確定のご連絡があります。',
    closedOnDate: 'この日は休業日です。別の日をお選びください。',
    // A request the boutique's hours refused (boutique_closed), naming the boutique.
    closedAtTime: (boutique: string) => `${boutique}はこの時間、営業時間外です。`,
    close: '閉じる',
    requested: 'ブティックの確認待ち',
    confirmed: '確定',
    confirmationSent: '確定 · LINEで送信済み',
    // Beside a confirmed visit's status tag, after a small check (components/status-tag.tsx).
    lineSent: 'LINEで送信済み',
    visitRequested: 'リクエストを送りました。ブティックからLINEで確定のご連絡があります。',
    // The concierge's hand-off (components/chat-parts.tsx), under the line handOffAt names (lib/tool-view.ts). Under a
    // hand-off that Strapi recorded (the model's hand_off_to_staff, or the app's own for a knowledge search that found
    // nothing): `note` thanks the customer and says an advisor will message them here, with the question's reference,
    // and `send` is the button that opens Maison's LINE chat with `typed` already in it (lineMessageUrl in
    // lib/line-chat.ts). `fallback` is for a question nothing recorded, because the hand-off failed: it says only where
    // the team answers, above "Chat with Maison on LINE", so a customer can always reach a person.
    handOff: {
      fallback: 'このようなご質問には、MaisonのLINEトークで担当者がお答えします。',
      note: (reference: string) => `ご質問ありがとうございます。少々お待ちください。クライアントアドバイザーがお調べのうえ、このLINEトークでご返信いたします（${reference}）。`,
      send: 'LINEトークで送る',
      typed: (reference: string, question: string) => `アドバイザーへの質問（${reference}）：${question}`,
    },
    // "Chat with Maison on LINE" (components/line-chat.tsx), a link LINE opens as the chat with Maison's Official
    // Account: on My visits under `line`, on a visit's page, after a booking, and in the concierge under `handOff.fallback`.
    // For a customer who hasn't added Maison yet (liff.getFriendship() in LINE mode), the add-friend words take their
    // place (lineChatWords in lib/line-chat.ts).
    lineChat: {
      button: 'LINEでMaisonにメッセージ',
      line: '確定のご連絡はMaisonのLINEトークにお届けします。',
      addButton: 'Maisonを友だち追加',
      addLine: '確定のご連絡をLINEで受け取るには、Maisonを友だち追加してください。',
    },
    noVisits: 'ご来店予約はまだありません。',
    visitNotFound: 'この予約は見つかりませんでした。',
    // A visit's details list: the pieces it's for, and the customer's note.
    visitPieces: 'お品物',
    visitNote: 'メッセージ',
    concierge: 'コンシェルジュ',
    // The concierge's title bar: the button that lists the screen's MCP tools.
    mcpTools: (n: number) => `${n}つのMCPツール`,
    conciergeIntro: 'ギフト選びやご来店のご予約をお手伝いします。',
    // With a piece (Ask about this piece): the intro and the suggestions in place of conciergeIntro and suggestions.
    conciergeIntroPiece: 'この商品について、お手入れ、サイズ、名入れ、配送など、何でもお尋ねください。',
    placeholder: 'メッセージを入力',
    send: '送信',
    // Under a reply that ended with nothing to read, beside `retry`'s button (the concierge page).
    noReply: '返信を受け取れませんでした。',
    suggestions: ['旅好きの友人へのギフトを40万円以内で探しています。土曜日の14時に銀座で見られますか？', '来店を予約できますか？'],
    // The concierge's visit picker (components/visit-picker.tsx): the button beside Send request, and the lines that take
    // the picker's place when the customer closed it, or moved past it by writing.
    notNow: '今回は見送る',
    pickerClosed: 'リクエストせずに閉じました。',
    pickerUnsent: 'リクエストは送信されていません。',
    pieceSuggestions: ['名入れはできますか？', 'お手入れ方法を教えてください。', 'どのブティックに在庫がありますか？'],
    results: (n: number) => `${n}件`,
    noProducts: 'このコレクションには、まだ商品がありません。',
    // Follows an error's copy when the server named the wait (Retry-After).
    tryAgainIn: (seconds: number) => (seconds < 60 ? `目安は${seconds}秒ほどです。` : `目安は${Math.ceil(seconds / 60)}分ほどです。`),
    // What people see for a tool's error code. The tools' hints are written for agents, so screens don't show them.
    errors: {
      not_found: 'お探しのものは見つかりませんでした。',
      invalid_input: '入力内容をご確認ください。',
      boutique_closed: 'この時間はブティックの営業時間外です。',
      in_the_past: 'もう少し先の日時をお選びください。',
      too_many_open_requests: '確認待ちのご予約が上限に達しています。ブティックの確認後に、新しくご予約いただけます。',
      not_signed_in: 'LINEでサインインしてください。',
      invalid_grant: 'LINEでもう一度サインインしてください。',
      temporarily_unavailable: 'LINEのサインインを確認できませんでした。しばらくしてからもう一度お試しください。',
      network: 'ただいまMaisonに接続できません。通信環境をご確認のうえ、もう一度お試しください。',
      server_error: 'Maisonで問題が発生しました。もう一度お試しください。',
      error: '問題が発生しました。もう一度お試しください。',
    },
  },
  en: {
    home: {
      eyebrow: 'Gifts, chosen with care',
      headline: 'Find the right piece. See it in person.',
      ctaLabel: 'Ask the concierge',
    },
    collections: 'Collections',
    pieces: (n: number) => `${n} pieces`,
    myVisits: 'My visits',
    homeNav: 'Home',
    agentView: 'Agent view',
    agentViewEmpty: 'No tool calls on this screen yet.',
    language: 'Language',
    signingIn: 'Signing in with LINE…',
    signInFailed: 'Sign-in failed',
    openInLine: {
      title: 'Open Maison in LINE',
      body: "Maison runs inside LINE. Scan this code with LINE's QR reader: in LINE, tap the QR icon next to the search bar.",
      bodyPhone: 'Maison runs inside LINE. Tap Open in LINE below.',
      button: 'Open in LINE',
      hint: 'Keeps opening in Safari or Chrome? In LINE, go to Settings → LINE Labs and turn off "Open links in your default browser".',
      alt: 'QR code that opens Maison in LINE',
    },
    backHome: 'Back to the start',
    chooseDate: 'Please choose a date.',
    dateTooSoon: 'Please choose a date from tomorrow on.',
    loading: 'Loading…',
    retry: 'Try again',
    size: 'Size',
    inStockAt: 'In stock',
    outOfStock: 'Out of stock',
    personalization: 'Personalization',
    personalizationKinds: {
      'initials-hot-stamp': 'Hot-stamped initials',
      'hand-painted-stripes': 'Hand-painted stripes',
      'monogram-color': 'Monogram in your choice of color',
    },
    leadDays: (n: number) => `About ${n} days`,
    bookVisit: 'Book a visit',
    askAboutPiece: 'Ask about this piece',
    boutique: 'Boutique',
    notInStock: 'not in stock',
    date: 'Date',
    time: 'Time',
    note: 'Note for the boutique',
    notePlaceholder: 'Who is it for? (optional)',
    request: 'Send request',
    confirmsOnLine: 'The boutique confirms your visit on LINE.',
    closedOnDate: 'Closed on this day. Please pick another.',
    closedAtTime: (boutique: string) => `${boutique} is closed at that time.`,
    close: 'Close',
    requested: 'Awaiting the boutique',
    confirmed: 'Confirmed',
    confirmationSent: 'Confirmed · LINE sent',
    lineSent: 'LINE sent',
    visitRequested: 'Request sent. The boutique will confirm on LINE.',
    handOff: {
      fallback: "Our team answers questions like this in Maison's LINE chat.",
      note: (reference: string) => `Thanks for asking! Give us a few minutes: one of our client advisors will message you here with the answer. (${reference})`,
      send: 'Send it in the LINE chat',
      typed: (reference: string, question: string) => `Question for a Maison advisor (${reference}): ${question}`,
    },
    lineChat: {
      button: 'Chat with Maison on LINE',
      line: 'Your confirmation arrives in the Maison chat.',
      addButton: 'Add Maison on LINE',
      addLine: 'Add Maison on LINE to get your confirmation there.',
    },
    noVisits: 'No visits yet.',
    visitNotFound: "We couldn't find this visit.",
    visitPieces: 'Pieces',
    visitNote: 'Note',
    concierge: 'Concierge',
    mcpTools: (n: number) => `${n} MCP tools`,
    conciergeIntro: 'I can help you choose a gift and book a boutique visit.',
    conciergeIntroPiece: 'Ask me anything about this piece: care, sizing, personalization, delivery.',
    placeholder: 'Write a message',
    send: 'Send',
    noReply: 'No reply came back.',
    suggestions: ["I'm looking for a gift under ¥400,000 for a friend who travels. Could I see it in Ginza on Saturday at 2 pm?", 'Can I book a visit?'],
    notNow: 'Not now',
    pickerClosed: 'Closed without a request.',
    pickerUnsent: 'No request sent.',
    pieceSuggestions: ['Can I have it personalized?', 'How do I care for it?', 'Which boutique has it in stock?'],
    results: (n: number) => `${n} result${n === 1 ? '' : 's'}`,
    noProducts: 'Nothing in this collection yet.',
    // Follows an error's copy when the server named the wait (Retry-After).
    tryAgainIn: (seconds: number) => {
      const [n, unit] = seconds < 60 ? [seconds, 'second'] : [Math.ceil(seconds / 60), 'minute'];
      return `That's about ${n} ${unit}${n === 1 ? '' : 's'}.`;
    },
    errors: {
      not_found: "We couldn't find that.",
      invalid_input: 'Please check what you entered.',
      boutique_closed: 'The boutique is closed at that time.',
      in_the_past: 'Please choose a later time.',
      too_many_open_requests: "You've reached the limit of visit requests waiting for a boutique. You can request another once one is confirmed.",
      not_signed_in: 'Please sign in with LINE.',
      invalid_grant: 'Please sign in with LINE again.',
      temporarily_unavailable: "LINE sign-in couldn't be checked. Please try again in a moment.",
      network: "We can't reach Maison right now. Check the connection and try again.",
      server_error: 'Something went wrong at Maison. Please try again.',
      error: 'Something went wrong. Please try again.',
    },
  },
} as const;
