const https = require('https');
// NOTE: Netlify Blobs (@netlify/blobs) kept throwing MissingBlobsEnvironmentError
// even when called inside the handler with esbuild bundling. Temporarily switched
// to an in-memory store so content generation works end-to-end; counts will reset
// whenever the function cold-starts (new deploy, or after idle). Revisit Blobs later.
const inMemoryUsers = {};

// ---------- Strategy Mapper ----------
const strategyMap = {
  '브랜딩': '스토리형 (창업가의 개인적인 스토리, 브랜드 철학, 비하인드 씬 및 감성적인 터치)',
  '검색 유입': '신뢰형 (전문적인 지식 공유, 구체적인 팁, 검색 상위 노출을 위한 실용 정보)',
  '문의': '공감형 (잠재 고객이 겪고 있는 페인 포인트 및 현실적 어려움을 깊이 공감하고 해결 실마리 제공)',
  '판매': '증거형 (제품/서비스의 수치적 효과, 상세 후기 및 리뷰, 강력한 장점 증명을 통한 직접 전환 유도)'
};

// ---------- Mock stock images ----------
const mockStockImages = [
  { url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&fit=crop', prompt: 'Tech network background' },
  { url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&fit=crop', prompt: 'Branding abstract illustration' },
  { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=800&fit=crop', prompt: 'Marketing chart dashboard' },
  { url: 'https://images.unsplash.com/photo-1551434678-e076c223a692?q=80&w=800&fit=crop', prompt: 'Startup office workspace' }
];

// ---------- Gemini REST call (native https, same as before) ----------
function callGeminiREST(modelName, apiKey, payload) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('JSON parsing failed from Gemini endpoint: ' + e.message));
          }
        } else {
          reject(new Error(`API responded with status code ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(JSON.stringify(payload));
    req.end();
  });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------- Retry wrapper (Netlify functions have a 10-26s timeout depending on plan, so keep it short) ----------
async function callRESTWithRetry(modelName, apiKey, payload, maxRetries = 4) {
  const retryIntervals = [1000, 1500, 2000, 2000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callGeminiREST(modelName, apiKey, payload);
    } catch (err) {
      const is503 = err.message.includes('503') || err.message.includes('UNAVAILABLE') || err.message.includes('high demand');
      if (is503 && attempt < maxRetries) {
        const nextDelay = retryIntervals[attempt] || 2000;
        console.warn(`[Retry] ${modelName} 503. attempt ${attempt + 1}/${maxRetries}, waiting ${nextDelay}ms`);
        await wait(nextDelay);
      } else {
        throw err;
      }
    }
  }
}

// ---------- Mock content (identical to original) ----------
function getMockContent(type, job, goal, strategy, isFinalFallback = false) {
  const prefix = isFinalFallback ? '[이건 예시 콘텐츠입니다] ' : '[무료체험 - Mock] ';
  const suffixPrompt = ', shot on iPhone 16 Pro, natural everyday lighting, slight smartphone camera characteristics (subtle noise in shadows, natural color science, computational photography look), candid unposed moment, realistic skin texture with visible pores, shallow depth of field from portrait mode, slightly imperfect framing like a real photo taken by a person, no airbrushing, no plastic skin, no overly symmetrical face';

  const mockImages = isFinalFallback ?
    mockStockImages.map((img) => ({ url: img.url, prompt: `[이건 예시 이미지입니다] ${img.prompt}${suffixPrompt}` })) :
    mockStockImages.map(img => ({ url: img.url, prompt: `${img.prompt}${suffixPrompt}` }));

  if (type === 'blog') {
    const bodyContent = `매일 인스타그램에 피드를 올리고 수백만 원짜리 파워링크 광고를 집행하는데도 예약이 단 한 건도 안 들어오는 날이 많더라고요.\n\n대체 무엇이 문제였을까요? 해답은 뻔한 홍보성 문구가 아니라, 고객의 고민을 꿰뚫어 보는 스토리 라인에 있었거든요.\n\n저도 사업 초기에는 고가의 장비와 깔끔한 인테리어만 갖춰놓으면 손님들이 절로 몰려올 줄 알았어요. 그런데 손님이 진짜 원한 것은 사장의 신념과 온기 섞인 디테일이었더라고요.\n\n저는 사실 공방의 월 매출을 높이기 위해 원데이 클래스 한 타임의 정원을 10명으로 늘리라는 주변 피드백을 전부 거절했거든요.\n\n정원을 대폭 늘리면 제 당장 이익 A는 배로 증가하겠지만, 수강생이 온전히 흙을 만지며 힐링하는 차분한 경험 B의 가치는 무조건 훼손될 거라 믿었기 때문입니다. 단 한 명의 고객이라도 본질적인 위안을 안고 돌아가야 비즈니스가 10년 넘게 굴러가더라고요.\n\n여러분도 당장 눈앞의 화려한 광고비 집행을 잠시 멈추고, 나만의 확고한 가치관이 듬뿍 묻어나는 스토리형 콘텐츠부터 정성껏 쌓아 올려 보세요. 처음에는 미미해 보여도, 진정성 있는 글 한 편이 수백만 원짜리 키워드 광고보다 훨씬 더 끈질기게 손님을 모셔다줄 테니까요.`;

    return {
      strategy_summary: `비즈니스 분야: ${job} / 목표: ${goal} / 글쓰기 전략: ${strategy}. 1인 사업자 관점에서 신념형 브랜딩 글 설계.`,
      main_keyword: `${job} 마케팅`,
      sub_keywords: '1인 창업, 소자본 브랜딩, 마케팅 자동화, 퍼스널 브랜드, 마케팅 노하우',
      selected_topic: `광고비 없이 스토리 하나로 ${job} 비즈니스 성장시키는 실전 전략`,
      title: `${prefix}${job} 사업자를 위한 마케팅 성장 로드맵`,
      body: bodyContent,
      content: bodyContent,
      hashtags: '#창업 #1인기업 #브랜딩 #마케팅전략 #공방창업 #마케팅자동화 #퍼스널브랜드 #성공노하우 #스토리텔링 #사업일기',
      images: mockImages
    };
  } else {
    const bodyContent = `🧵 1/5. 매일 열심히 사는데 통장 잔고는 왜 제자리일까요? 그건 고객의 마음에 드는 스토리가 없기 때문이더라고요.\n\n🧵 2/5. 광고비를 왕창 써도 반응이 없다면, 나만의 확고한 사업 철학이 빠져 있는 경우가 허다하거든요.\n\n🧵 3/5. 저는 사실 월수입을 올리려고 강의 수를 늘려달라는 파트너사의 제안을 단칼에 거절했거든요.\n\n🧵 4/5. 제 당장의 마진 A는 포기되더라도, 수강생 한 분 한 분께 1:1로 집중 밀착하여 케어하는 B의 가치가 100배 소중했기 때문입니다.\n\n🧵 5/5. 뻔한 방법은 이제 그만하고, 진짜 고객의 눈을 사로잡는 스토리텔링 마케팅을 지금부터 가볍게 시작해보세요!`;

    return {
      strategy_summary: `비즈니스 분야: ${job} / 목표: ${goal} / 글쓰기 전략: ${strategy}. 짧고 임팩트 있는 스레드 타래 설계.`,
      main_keyword: `${job} 꿀팁`,
      sub_keywords: '스레드 마케팅, 1인 사업 생존기, 트래픽 유입, SNS 홍보, 사업 꿀팁',
      selected_topic: `1인 ${job} 창업자가 겪는 핵심 오류 극복`,
      title: `${prefix}치명적 실수 1가지`,
      body: bodyContent,
      content: bodyContent,
      hashtags: '#창업 #스레드 #마케팅 #1인기업 #소셜마케팅 #동기부여 #비즈니스',
      images: []
    };
  }
}

// ---------- Limit tracking (temporary in-memory, Blobs bypassed for now) ----------
async function handleLimitCheck(email) {
  const defaultVal = { blog_count: 0, thread_count: 0 };
  if (!inMemoryUsers[email]) {
    inMemoryUsers[email] = { ...defaultVal };
  }
  return inMemoryUsers[email];
}

async function handleLimitIncrement(email, contentType) {
  const column = contentType === 'blog' ? 'blog_count' : 'thread_count';
  if (!inMemoryUsers[email]) {
    inMemoryUsers[email] = { blog_count: 0, thread_count: 0 };
  }
  inMemoryUsers[email][column]++;
}

// ---------- Prompt builders (identical text to original server.js) ----------
function buildBlogPrompt(userJob, contentGoal, contentLink, contentRequest) {
  return `너는 최고의 1인 사업자 콘텐츠 전략가야. 아래 가이드라인(전략->기획->제작 순서)을 완벽히 지켜서
고화질 콘텐츠 패키지를 완성해줘.

[입력 정보]
- 하는일: ${userJob}
- 목표: ${contentGoal}
- 링크: ${contentLink || '없음'}
- 추가요청: ${contentRequest || '없음'}

[목표에 따른 전략 유형 매핑]
- 브랜딩 = 스토리형
- 검색유입 = 신뢰형
- 문의 = 공감형
- 판매 = 증거형

[작업 진행 순서]
1. 링크가 제공되었다면 분석하고, 없다면 입력 정보를 기반으로 비즈니스 상세 맥락을 추론한다.
2. 타깃 독자가 누구이며, 그들의 핵심 고민, 그리고 전달할 핵심 마케팅 메시지를 결정한다.
3. 메인 키워드 1개 + 서브 키워드 5개 + 글의 주제 후보 10개를 선정한 뒤, 그 중 가장 킬러 주제 1개를 최종 선택한다.
4. 검색 노출을 위한 SEO 제목 후보 5개를 선정한 뒤, 그 중 가장 임팩트 있는 제목 1개를 최종 선택한다.
5. 아래 [본문 조건] 및 [신뢰 결정타 문장] 규칙을 반드시 지켜 본문을 작성한다.
6. 본문 내용에 부합하는 [이미지 조건]에 맞춘 영문 프롬프트 4개를 기획한다.
7. 연관성이 높은 인스타그램/블로그 업로드용 해시태그 10개를 생성한다.

[본문 조건 - 필수 준수]
- 분량: 1500자~2000자 수준으로 상세하고 알차게 정보글로 작성할 것
- 말투: 친근하고 자연스러운 구어체 존댓말(~더라고요 / ~거든요체)을 사용할 것
- 금지 사항: 절대로 AI 냄새가 나거나, 뻔한 광고체, 상투적인 어조를 쓰지 말 것 (특히 '오늘은~알아보겠습니다', '결론부터', '첫째둘째셋째', '따라서', '즉' 같은 단어의 사용 절대 금지)
- 가독성: 한 문단은 최대 3줄을 넘지 않도록 짧게 끊어(줄바꿈)를 넣어서 구분할 것
- 기법: 막연하고 흐린 설명보다는 구체적인 감각의 실제 에피소드를 먼저 제시하며 시작할 것, 여운을 남기는 문장으로
문맥이 부드럽게 마무리될 것

[신뢰 결정타 문장 - 필수 준수]
- 본문 중간~마무리 직전에 이 1인 사업자만의 남다른 사업 신념 문장 1개를 반드시 배치할 것
- '고객이 최우선입니다' 같은 뻔한 영업 멘트는 금지
- 대비 구조: 이 업계의 일반적인 이익 구조와 반대되는, 자신의 직접적인 이익 A(예: 단가 올리기, 강의 늘리기 등)보다 고객의 가치/이익 B가 훨씬 소중하고 중요하다는 구체적이고 의외인 신념이어야 함
- 설득력: 왜 그렇게 생각하는지에 대한 짧은 철학이나 한 줄 비하인드를 덧붙여 진정성을 줄 것

[이미지 조건]
- 이미지 개수: 총 4개 (대표 이미지 1개 + 본문용 이미지 3개)
- 프롬프트 포맷: 반드시 1:1 비율(1:1 ratio), 실사 스타일(photorealistic), 텍스트 배제(no text, no letters)를 적용한 영어 프롬프트로 작성할 것.
- 프롬프트 마무리 꼬리 문구 (필수 추가): 모든 이미지 생성 프롬프트의 맨 끝(마지막 부분)에는 반드시 아래의 영어 문구를 글자 그대로 똑같이 추가하여 작성해야 해:
  "shot on iPhone 16 Pro, natural everyday lighting, slight smartphone camera characteristics (subtle noise in shadows, natural color science, computational photography look), candid unposed moment, realistic skin texture with visible pores, shallow depth of field from portrait mode, slightly imperfect framing like a real photo taken by a person, no airbrushing, no plastic skin, no overly symmetrical face"
- 금지 단어/문구 (프롬프트 내에 아래 단어들은 절대 포함시키지 마):
  "perfect", "flawless", "highly detailed", "8k", "hyperrealistic", "studio lighting", "professional photoshoot", "DSLR", "50mm lens"
- 인물 묘사: 인물이 등장하는 프롬프트의 경우, 반드시 한국인 또는 동아시아인의 외모와 헤어스타일, 분위기로 묘사해야 하며 (영어 프롬프트 내에 "Korean person" 또는 "East Asian appearance"를 명시적으로 삽입), 그 뒤에 바로 위의 "shot on iPhone 16 Pro..."로 시작하는 꼬리 문구를 공백을 두고 이어서 붙여서 완성할 것.

[출력 포맷 규칙]
- 절대로 설명이나 마크다운 백틱 코드블록(\`\`\`json 등)을 두르지 말고 오로지 파싱 가능한 순수 JSON 텍스트 하나만 리턴해줘. JSON 규격:
{
  "strategy_summary": "[전략/타겟 고민 및 메시지 결정 요약]",
  "main_keyword": "[대표 키워드 1개]",
  "sub_keywords": "[서브 키워드 5개를 콤마로 구분한 문자열]",
  "selected_topic": "[선정된 주제 1개]",
  "title": "[최종 선정된 SEO 블로그 제목]",
  "body": "[1500~2000자 본문 글 내용]",
  "hashtags": "[해시태그 10개]",
  "image_prompt_1": "[대표 이미지 1 영문 프롬프트]",
  "image_prompt_2": "[본문 이미지 2 영문 프롬프트]",
  "image_prompt_3": "[본문 이미지 3 영문 프롬프트]",
  "image_prompt_4": "[본문 이미지 4 영문 프롬프트]"
}`;
}

function buildThreadPrompt(userJob, contentGoal, contentLink, contentRequest) {
  return `너는 최고의 1인 사업자 콘텐츠 전략가야. 아래 가이드라인을 지켜 SNS 트래픽을 몰고 올 임팩트 있는 스레드 패키지를 완성해줘.

[입력 정보]
- 하는일: ${userJob}
- 목표: ${contentGoal}
- 링크: ${contentLink || '없음'}
- 추가요청: ${contentRequest || '없음'}

[목표에 따른 전략 유형 매핑]
- 브랜딩 = 스토리형
- 검색유입 = 신뢰형
- 문의 = 공감형
- 판매 = 증거형

[작업 진행 순서]
1. 링크가 제공되었다면 분석하고, 없다면 입력 정보를 기반으로 비즈니스 상세 맥락을 추론한다.
2. 타깃 독자의 페르소나, 그들의 핵심 고민, 그리고 전달할 핵심 마케팅 메시지를 결정한다.
3. 메인 키워드 1개 + 서브 키워드 5개 + 글의 주제 후보 10개를 선정한 뒤, 그 중 가장 킬러 주제 1개를 최종 선택한다.
4. SNS 타겟팅용 제목 후보 5개를 선정한 뒤, 그 중 가장 임팩트 있는 제목 1개를 최종 선택한다.
5. 아래 세부 [스레드 본문 조건] 및 [신뢰 결정타 문장] 규칙을 지켜 스레드를 작성한다. (이미지 관련 기획 및 프롬프트 추출은 완전히 배제한다.)
6. 연관성이 높은 인스타그램/스레드 업로드용 해시태그 10개를 생성한다.

[스레드 본문 조건 - 필수 준수]
- 분량: 전체 스레드 5~8문장 내외의 짤막하고 명쾌한 문체로 구성할 것.
- 구성: 첫 머리는 사람들의 이목을 끄는 강력한 훅(Hook)으로 시작할 것.
- 말투: 친근하고 자연스러운 구어체 존댓말 (~더라고요 / ~거든요체)을 사용할 것.
- 금지 사항: 절대로 AI 냄새가 나거나, 뻔한 광고체, 상투적인 어조를 쓰지 말 것. (특히 '오늘은~알아보겠습니다', '결론부터', '첫째둘째셋째', '따라서', '즉' 같은 단어는 사용 절대 금지)
- 가독성: 1줄~2줄 단위로 이모지와 함께 넓게 줄바꿈(개행)하여 가독성을 극대화할 것.

[신뢰 결정타 문장 - 필수 준수]
- 스레드 중간~마무리 직전에 이 1인 사업자만의 남다른 사업 신념 문장 1개를 짧고 강렬하게 포함할 것.
- '고객이 최우선입니다' 같은 뻔한 영업 멘트는 금지.
- 대비 구조: 이 업계의 일반적인 이익 구조와 반대되는, 자신의 직접적인 이익 A(예: 단가 올리기, 강의 늘리기 등)보다 고객의 가치/이익 B가 훨씬 소중하고 중요하다는 구체적이고 의외인 신념이어야 함.
- 설득력: 왜 그렇게 생각하는지에 대한 짧은 철학이나 한 줄 비하인드를 덧붙여 진정성을 줄 것.

[출력 포맷 규칙]
- 절대로 설명이나 마크다운 백틱 코드블록(\`\`\`json 등)을 두르지 말고 오로지 파싱 가능한 순수 JSON 텍스트 하나만 리턴해줘. JSON 규격:
{
  "strategy_summary": "[전략/타겟 고민 및 메시지 결정 요약]",
  "main_keyword": "[대표 키워드 1개]",
  "sub_keywords": "[서브 키워드 5개를 콤마로 구분한 문자열]",
  "selected_topic": "[선정된 주제 1개]",
  "title": "[스레드 메인 주제 키워드]",
  "body": "[스레드 5~8문장 분량의 타래형 텍스트 본문 (훅으로 시작, 이모지와 줄바꿈 적용)]",
  "hashtags": "[해시태그 10개]"
}`;
}

// ---------- Netlify Function handler ----------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON body' }) };
  }

  const { userEmail, userName, userJob, contentType, contentGoal, contentLink, contentRequest } = body;

  if (!userEmail || !userJob || !contentGoal || !contentType) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Mandatory fields are missing.' }) };
  }

  const selectedStrategy = strategyMap[contentGoal] || '스토리형 전략';
  const limits = { blog: 2, thread: 5 };

  const counts = await handleLimitCheck(userEmail);
  const currentCount = contentType === 'blog' ? counts.blog_count : counts.thread_count;

  if (currentCount >= limits[contentType]) {
    return {
      statusCode: 403,
      body: JSON.stringify({
        success: false,
        reason: 'limit_exceeded',
        limit: limits[contentType],
        current: currentCount,
        contentType
      })
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  let warningMessage = '';
  let generatedResult = null;

  if (!apiKey || apiKey.trim() === '') {
    generatedResult = getMockContent(contentType, userJob, contentGoal, selectedStrategy, false);
    return finalizeResponse(generatedResult, counts, apiKey, warningMessage);
  }

  try {
    const prompt = contentType === 'blog'
      ? buildBlogPrompt(userJob, contentGoal, contentLink, contentRequest)
      : buildThreadPrompt(userJob, contentGoal, contentLink, contentRequest);

    const textPayload = { contents: [{ parts: [{ text: prompt }] }] };

    let textResult = null;
    let textSuccess = true;

    try {
      textResult = await callRESTWithRetry('gemini-3.5-flash', apiKey, textPayload, 4);
    } catch (textApiErr) {
      console.error('[Critical] text generation retries exhausted:', textApiErr.message);
      textSuccess = false;
      warningMessage = '지금 AI 서버 사용량이 많아 생성이 지연되고 있어요. 잠시 후 다시 시도해주세요. 대신 예시 콘텐츠를 보여드립니다.';
    }

    let parsed = null;
    if (textSuccess && textResult) {
      const responseText = textResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let cleanJsonText = responseText.trim();
      if (cleanJsonText.startsWith('```')) {
        cleanJsonText = cleanJsonText.replace(/^```json/, '').replace(/```$/, '').trim();
      }
      try {
        parsed = JSON.parse(cleanJsonText);
      } catch (jsonErr) {
        console.error('[Error] JSON parse failed, using fallback.');
        textSuccess = false;
      }
    }

    let images = [];
    if (textSuccess && parsed && contentType === 'blog') {
      const prompts = [parsed.image_prompt_1, parsed.image_prompt_2, parsed.image_prompt_3, parsed.image_prompt_4].filter(Boolean);
      for (const promptText of prompts) {
        try {
          const imagePayload = {
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '2K' } }
          };
          const imgResult = await callRESTWithRetry('gemini-3.1-flash-image', apiKey, imagePayload, 4);
          const part = imgResult.candidates?.[0]?.content?.parts?.[0];
          if (part && part.inlineData) {
            images.push({ url: `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`, prompt: promptText });
          } else {
            throw new Error('No inlineData returned from Gemini image REST API.');
          }
        } catch (imageErr) {
          console.error('[Critical] image generation failed:', imageErr.message);
          images.push({ url: 'error', error: '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.', prompt: promptText });
        }
      }
    }

    if (!textSuccess || !parsed) {
      generatedResult = getMockContent(contentType, userJob, contentGoal, selectedStrategy, true);
    } else {
      const bodyContent = parsed.body || parsed.content || '';
      generatedResult = { ...parsed, body: bodyContent, content: bodyContent, images };
    }
  } catch (err) {
    console.error('[Critical] execution breakdown:', err.message);
    warningMessage = '생성 도중 오류가 발생했습니다. 아래 예시 콘텐츠를 보여드립니다.';
    generatedResult = getMockContent(contentType, userJob, contentGoal, selectedStrategy, true);
  }

  return finalizeResponse(generatedResult, counts, apiKey, warningMessage);

  async function finalizeResponse(resultObj, currentCounts, key, warning) {
    try {
      await handleLimitIncrement(userEmail, contentType, currentCounts);
    } catch (incErr) {
      console.error('[Error] limit increment failed:', incErr.message);
    }
    const nextCount = (currentCounts[contentType === 'blog' ? 'blog_count' : 'thread_count'] || 0) + 1;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        success: true,
        isMock: !key || warning !== '',
        warning_message: warning,
        title: resultObj.title,
        content: resultObj.content || resultObj.body,
        body: resultObj.body,
        strategy_summary: resultObj.strategy_summary,
        main_keyword: resultObj.main_keyword,
        sub_keywords: resultObj.sub_keywords,
        selected_topic: resultObj.selected_topic,
        hashtags: resultObj.hashtags,
        images: resultObj.images,
        limit: limits[contentType],
        current: nextCount
      })
    };
  }
};
