const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname))); // Serve files from root directory

// Initialize Vercel KV with In-Memory fallback for local development or missing configurations
let kv = null;
let useKV = false;
const inMemoryUsers = {}; // Local memory limit store fallback

try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const vercelKv = require('@vercel/kv');
    kv = vercelKv.kv;
    useKV = true;
    console.log('Connected to Vercel KV Database (Redis). Active cloud store enabled.');
  } else {
    console.log('Vercel KV envs missing. Using local In-Memory limits tracking.');
  }
} catch (e) {
  console.warn('[Warning] @vercel/kv module load failed. Using local In-Memory limits tracking.', e.message);
  kv = null;
  useKV = false;
}

// Strategy Mapper
const strategyMap = {
  '브랜딩': '스토리형 (창업가의 개인적인 스토리, 브랜드 철학, 비하인드 씬 및 감성적인 터치)',
  '검색 유입': '신뢰형 (전문적인 지식 공유, 구체적인 팁, 검색 상위 노출을 위한 실용 정보)',
  '문의': '공감형 (잠재 고객이 겪고 있는 페인 포인트 및 현실적 어려움을 깊이 공감하고 해결 실마리 제공)',
  '판매': '증거형 (제품/서비스의 수치적 효과, 상세 후기 및 리뷰, 강력한 장점 증명을 통한 직접 전환 유도)'
};

// Curated stock photos for Mock mode
const mockStockImages = [
  { url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=800&fit=crop', prompt: 'Tech network background' },
  { url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800&fit=crop', prompt: 'Branding abstract illustration' },
  { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=800&fit=crop', prompt: 'Marketing chart dashboard' },
  { url: 'https://images.unsplash.com/photo-1551434678-e076c223a692?q=80&w=800&fit=crop', prompt: 'Startup office workspace' }
];

// Helper to create Pollinations AI image URLs (Only used as absolute fallback if Gemini model is rate-limited or fails)
function getFallbackImageUrl(promptText) {
  const cleanPrompt = promptText.trim().replace(/[^a-zA-Z0-9\s,.\-]/g, '');
  const encoded = encodeURIComponent(cleanPrompt);
  const randomSeed = Math.floor(Math.random() * 1000000);
  return `https://image.pollinations.ai/prompt/${encoded}?width=800&height=600&nologo=true&seed=${randomSeed}`;
}

// REST API Helper using Native HTTPS module
function callGeminiREST(modelName, apiKey, payload) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
  console.log(`[API Call] Endpoint: https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`);
  console.log(`[API Call] Model: ${modelName}`);
  console.log(`[API Call] Payload (Request Body):\n${JSON.stringify(payload, null, 2)}`);

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      res.on('end', () => {
        const rawBuffer = Buffer.concat(chunks);
        const data = rawBuffer.toString('utf-8');
        
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

    req.on('error', (e) => {
      reject(e);
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

// Delay Helper for retries
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Retry Wrapper handling 503 errors strictly
async function callRESTWithRetry(modelName, apiKey, payload, maxRetries = 5) {
  const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION !== undefined;
  const retryIntervals = isVercel ? 
    [1000, 1500, 2000, 2000, 2000] : // Vercel: max 8.5s total wait
    [5000, 10000, 20000, 30000, 40000]; // Standard: max 105s total wait
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await callGeminiREST(modelName, apiKey, payload);
      return result; // Success
    } catch (err) {
      const is503 = err.message.includes('503') || err.message.includes('UNAVAILABLE') || err.message.includes('high demand');
      
      if (is503 && attempt < maxRetries) {
        const nextDelay = retryIntervals[attempt] || 2000;
        console.warn(`[Retry Warning] Model ${modelName} returned 503. Retrying attempt ${attempt + 1}/${maxRetries} after ${nextDelay / 1000}s...`);
        await wait(nextDelay);
      } else {
        throw err;
      }
    }
  }
}

// Generate Mock Content (Unified structure carrying BOTH 'content' and 'body' to prevent undefined bugs)
function getMockContent(type, job, goal, strategy, isFinalFallback = false) {
  const prefix = isFinalFallback ? '[이건 예시 콘텐츠입니다] ' : '[무료체험 - Mock] ';
  const suffixPrompt = ', shot on iPhone 16 Pro, natural everyday lighting, slight smartphone camera characteristics (subtle noise in shadows, natural color science, computational photography look), candid unposed moment, realistic skin texture with visible pores, shallow depth of field from portrait mode, slightly imperfect framing like a real photo taken by a person, no airbrushing, no plastic skin, no overly symmetrical face';
  
  const mockImages = isFinalFallback ? 
    mockStockImages.map((img, idx) => ({ url: img.url, prompt: `[이건 예시 이미지입니다] ${img.prompt}${suffixPrompt}` })) :
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
      content: bodyContent, // Fail-safe copy
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
      content: bodyContent, // Fail-safe copy
      hashtags: '#창업 #스레드 #마케팅 #1인기업 #소셜마케팅 #동기부여 #비즈니스',
      images: []
    };
  }
}

// Async Helper to track and update count limit using Vercel KV (Redis)
async function handleLimitCheck(email) {
  const defaultVal = { blog_count: 0, thread_count: 0 };
  if (useKV && kv) {
    try {
      const userCounts = await kv.hgetall(`user:${email}`);
      if (!userCounts) return defaultVal;
      return {
        blog_count: parseInt(userCounts.blog_count || 0, 10),
        thread_count: parseInt(userCounts.thread_count || 0, 10)
      };
    } catch (e) {
      console.error('Vercel KV fetch error:', e.message);
    }
  }
  // Local fallback
  if (!inMemoryUsers[email]) {
    inMemoryUsers[email] = { ...defaultVal };
  }
  return inMemoryUsers[email];
}

// Async Helper to increment limits
async function handleLimitIncrement(email, contentType, currentCounts) {
  const column = contentType === 'blog' ? 'blog_count' : 'thread_count';
  if (useKV && kv) {
    try {
      const nextVal = (currentCounts[column] || 0) + 1;
      await kv.hset(`user:${email}`, { [column]: nextVal });
      return;
    } catch (e) {
      console.error('Vercel KV increment error:', e.message);
    }
  }
  // Local fallback
  if (inMemoryUsers[email]) {
    inMemoryUsers[email][column]++;
  }
}

// Content generation route
app.post('/api/generate', async (req, res) => {
  console.log('\n=========================================');
  console.log('[Form Submission Received] Data:');
  console.log(JSON.stringify(req.body, null, 2));
  console.log('=========================================\n');

  const { userEmail, userName, userJob, contentType, contentGoal, contentLink, contentRequest } = req.body;

  if (!userEmail || !userJob || !contentGoal || !contentType) {
    return res.status(400).json({ success: false, error: 'Mandatory fields are missing.' });
  }

  const selectedStrategy = strategyMap[contentGoal] || '스토리형 전략';
  const limits = { blog: 1, thread: 2 };

  try {
    // 1. Fetch current limits count
    const counts = await handleLimitCheck(userEmail);
    const currentCount = contentType === 'blog' ? counts.blog_count : counts.thread_count;

    if (currentCount >= limits[contentType]) {
      return res.status(403).json({
        success: false,
        reason: 'limit_exceeded',
        limit: limits[contentType],
        current: currentCount,
        contentType: contentType
      });
    }

    // Process Content Generation
    let generatedResult = null;
    const apiKey = process.env.GEMINI_API_KEY;
    let warningMessage = '';

    if (!apiKey || apiKey.trim() === '') {
      console.log('[Status] Gemini API Key is missing. Using standard Mock Content...');
      generatedResult = getMockContent(contentType, userJob, contentGoal, selectedStrategy, false);
      return sendResponse(generatedResult, counts);
    }

    try {
      let prompt = '';
      if (contentType === 'blog') {
        prompt = `너는 최고의 1인 사업자 콘텐츠 전략가야. 아래 가이드라인(전략->기획->제작 순서)을 완벽히 지켜서 고화질 콘텐츠 패키지를 완성해줘.

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
4. 검색 노출을 위한 SEO 제목 후보 5개를 선정한 뒤, 그 중 가장 임팩트 있는 제목 1개를 최종 선택한다.
5. 아래 세부 [본문 조건] 및 [신뢰 결정타 문장] 규칙을 반드시 지켜 본문을 작성한다.
6. 본문 내용에 부합하는 [이미지 조건]에 맞춘 영문 프롬프트 4개를 기획한다.
7. 연관성이 높은 인스타그램/블로그 업로드용 해시태그 10개를 생성한다.

[본문 조건 - 필수 준수]
- 분량: 1500자 ~ 2000자 수준의 자세하고 튼실한 정보글로 작성할 것.
- 말투: 친근하고 자연스러운 구어체 존댓말 (~더라고요 / ~거든요체)을 사용할 것.
- 금지 사항: 절대로 AI 냄새가 나거나, 뻔한 광고체, 상투적인 어조를 쓰지 말 것. (특히 '오늘은~알아보겠습니다', '결론부터', '첫째둘째셋째', '따라서', '즉' 같은 단어는 사용 절대 금지)
- 가독성: 한 문단은 최대 3줄을 넘지 않도록 짧게 엔터(줄바꿈)를 쳐서 구분할 것.
- 기법: 장황한 이론 설명보다 구체적인 가상의 사례나 에피소드를 먼저 제시하며 서술을 시작할 것. 완결된 문장으로 문맥을 부드럽게 마무리할 것.

[신뢰 결정타 문장 - 필수 준수]
- 본문 중간~마무리 직전에 이 1인 사업자만의 남다른 사업 신념 문장 1개를 반드시 배치할 것.
- '고객이 최우선입니다' 같은 뻔한 영업 멘트는 금지.
- 대비 구조: 이 업계의 일반적인 이익 구조와 반대되는, 자신의 직접적인 이익 A(예: 객단가 높이기, 클래스 인원 늘리기 등)보다 고객의 가치/이익 B(수강생이 1:1로 밀착 힐어받는 시간 등)가 훨씬 소중하고 중요하다는 구체적이고 의외인 신념이어야 함.
- 설득력: 왜 그렇게 생각하는지에 대한 1인 창업자의 짧은 비하인드 계기나 철학을 덧붙여 실제 일어난 일처럼 진정성을 불어넣을 것.

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
      } else {
        prompt = `너는 최고의 1인 사업자 콘텐츠 전략가야. 아래 가이드라인을 지켜 SNS 트래픽을 몰고 올 임팩트 있는 스레드 패키지를 완성해줘.

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
- 분량: 4~6줄, 총 70~120자 내외. 스크롤하다 툭 멈추게 만드는 짧은 글이되, 로봇처럼 딱딱 끊어치지 말고 사람이 실제로 생각을 이어가듯 자연스러운 호흡으로 쓸 것.
- 말투: 친한 사람한테 편하게 툭 던지듯 하는 반말체 (~야 / ~해 / ~거든 / ~더라 / ~네). 존댓말 절대 금지. 문장을 억지로 자르지 말고, 실제 대화하듯 자연스럽게 이어질 부분은 이어 쓸 것.
- 흐름 (아래 세 가지 역할을 자연스럽게 녹여 쓰되, 정해진 공식처럼 기계적으로 나누지 말 것):
  1) 첫 줄은 읽는 사람이 "어?" 하고 멈추게 만드는 한마디로 시작. 반전이든 공감이든 단언이든 질문이든 형식은 자유롭게 고르되, 매번 같은 패턴을 반복하지 말 것.
  2) 이어서 이 업계의 뻔한 방식과는 다른, 이 사업자만의 의외의 태도나 기준을 담백하게 던질 것. 설명하거나 이유를 나열하지 말고 실제로 그렇게 생각한다는 느낌이 들게 짧게 보여줄 것.
  3) 마지막 줄은 자연스럽게 반응(팔로우/저장/댓글/DM)을 유도하되, 매번 똑같은 문구를 재사용하지 말고 그 글의 맥락에서 자연스럽게 이어지는 한마디로 마무리할 것. 질문형이어도 되고 아니어도 됨.
- 금지 사항: 절대로 AI 냄새가 나거나, 뻔한 광고체, 상투적인 어조를 쓰지 말 것. (특히 '오늘은~알아보겠습니다', '결론부터', '첫째둘째셋째', '따라서', '즉' 같은 단어는 사용 절대 금지. 존댓말 어미도 금지) 예시로 든 문구를 그대로 베끼지 말고 매번 새로운 표현으로 쓸 것.
- 이모지/이모티콘은 절대 사용하지 말 것 (텍스트로만 작성).
- 가독성: 자연스러운 호흡 단위로 짧게 줄바꿈(개행)할 것. 다만 모든 줄을 억지로 초단문으로 끊어서 부자연스럽게 만들지는 말 것.

[출력 포맷 규칙]
- 절대로 설명이나 마크다운 백틱 코드블록(\`\`\`json 등)을 두르지 말고 오로지 파싱 가능한 순수 JSON 텍스트 하나만 리턴해줘. JSON 규격:
{
  "strategy_summary": "[전략/타겟 고민 및 메시지 결정 요약]",
  "main_keyword": "[대표 키워드 1개]",
  "sub_keywords": "[서브 키워드 5개를 콤마로 구분한 문자열]",
  "selected_topic": "[선정된 주제 1개]",
  "title": "[스레드 메인 주제 키워드 (화면에는 노출되지 않음, 내부 참고용)]",
  "body": "[4~6줄, 총 70~120자 내외의 자연스러운 반말체 스레드 본문 (첫 줄 훅 -> 의외의 태도/기준 -> 자연스러운 반응 유도 한마디, 이모지 없이 줄바꿈만 적용, 기계적으로 문장을 자르지 말 것)]",
  "hashtags": "[해시태그 10개]"
}`;
      }

      const textPayload = {
        contents: [{ parts: [{ text: prompt }] }]
      };

      let textResult = null;
      let textSuccess = true;

      try {
        textResult = await callRESTWithRetry('gemini-3.5-flash', apiKey, textPayload, 5);
      } catch (textApiErr) {
        console.error('[Critical Error] 503 Retries exhausted for text generation:', textApiErr.message);
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
          console.error('[Error] Parsing AI JSON response failed, using fallback.');
          textSuccess = false;
        }
      }

      let images = [];

      if (textSuccess && parsed && contentType === 'blog') {
        const prompts = [
          parsed.image_prompt_1,
          parsed.image_prompt_2,
          parsed.image_prompt_3,
          parsed.image_prompt_4
        ].filter(Boolean);

        for (let i = 0; i < prompts.length; i++) {
          const promptText = prompts[i];
          try {
            const imagePayload = {
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: {
                  imageSize: "2K"
                }
              }
            };
            
            console.log(`[API Call] Configured Resolution: 2K, Modalities: ["IMAGE"]`);
            
            const imgResult = await callRESTWithRetry('gemini-3.1-flash-image', apiKey, imagePayload, 5);
            const part = imgResult.candidates?.[0]?.content?.parts?.[0];
            
            if (part && part.inlineData) {
              const mimeType = part.inlineData.mimeType || 'image/jpeg';
              const base64Data = part.inlineData.data;
              images.push({
                url: `data:${mimeType};base64,${base64Data}`,
                prompt: promptText
              });
            } else {
              throw new Error('No inlineData returned from Gemini image REST API.');
            }
          } catch (imageErr) {
            console.error(`[Critical Error] 503 Retries exhausted for Image ${i + 1} generation:`, imageErr.message);
            images.push({
              url: 'error',
              error: '이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.',
              prompt: promptText
            });
          }
        }
      }

      if (!textSuccess || !parsed) {
        generatedResult = getMockContent(contentType, userJob, contentGoal, selectedStrategy, true);
      } else {
        const bodyContent = parsed.body || parsed.content || '';
        generatedResult = {
          strategy_summary: parsed.strategy_summary,
          main_keyword: parsed.main_keyword,
          sub_keywords: parsed.sub_keywords,
          selected_topic: parsed.selected_topic,
          title: parsed.title,
          body: bodyContent,
          content: bodyContent,
          hashtags: parsed.hashtags,
          images: images
        };
      }
    } catch (err) {
      console.error('[Critical Error] Critical execution breakdown. Using final fallback:', err.message);
      warningMessage = '생성 도중 오류가 발생했습니다. 아래 예시 콘텐츠를 보여드립니다.';
      generatedResult = getMockContent(contentType, userJob, contentGoal, selectedStrategy, true);
    }

    sendResponse(generatedResult, counts);

    // Send HTTP Response helper
    async function sendResponse(resultObj, currentCounts) {
      try {
        await handleLimitIncrement(userEmail, contentType, currentCounts);
        const nextCount = (currentCounts[contentType === 'blog' ? 'blog_count' : 'thread_count'] || 0) + 1;
        
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({
          success: true,
          isMock: !apiKey || warningMessage !== '',
          warning_message: warningMessage,
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
        });
      } catch (incErr) {
        console.error('Limit increment processing breakdown:', incErr.message);
        res.status(500).json({ success: false, error: 'Limit counter processing error.' });
      }
    }
  } catch (checkErr) {
    console.error('Limit checking processing breakdown:', checkErr.message);
    res.status(500).json({ success: false, error: 'Database tracking error.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
