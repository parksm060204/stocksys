import {
  CommodityEventTemplate,
  ActiveCommodityEvent,
  CommodityNewsItem,
} from './types';

/**
 * 전역 원자재 시장 이벤트 템플릿 풀
 */
export const EVENT_TEMPLATES: CommodityEventTemplate[] = [
  // ── 1. 지정학적 위기 (Geopolitical & War) ──
  {
    id: 'EV_MIDDLE_EAST_WAR',
    title: '중동 호르무즈 해협 군사적 긴장 고조',
    headline: '🚨 [긴급속보] 호르무즈 해협 봉쇄 위기… 유조선 통항 중단 선언',
    description: '원유 및 LNG 수송의 핵심 관문 봉쇄 위기로 에너지 공급망에 심각한 차질이 예상됩니다.',
    targetCategories: ['energy'],
    magnitude: 0.055, // +5.5% 급등 충격
    decayTicks: 40,
    probability: 0.003,
  },
  {
    id: 'EV_SAFE_HAVEN_RUSH',
    title: '글로벌 금융 시장 불안 및 안전자산 쏠림',
    headline: '👑 [시장동향] 글로벌 안전자산 매수세 집중… 금·은 사상 최고치 경신 행진',
    description: '환율 변동성 확대 및 주요국 국채 불안으로 인해 귀금속 수요가 폭발적으로 증가하고 있습니다.',
    targetCategories: ['precious_metals'],
    magnitude: 0.035, // +3.5%
    decayTicks: 35,
    probability: 0.004,
  },

  // ── 2. 기후 및 이상 기상 (Climate & Agriculture) ──
  {
    id: 'EV_EL_NINO_DROUGHT',
    title: '극심한 엘니뇨 현상으로 북미/남미 대규모 가뭄',
    headline: '🌾 [기후비상] 사상 최악의 가뭄… 곡물 지대 작황 전멸 위기',
    description: '미국 콘벨트 및 남미 농경지에 비가 내리지 않아 밀과 대두 수확량 전망치가 30% 하향되었습니다.',
    targetCategories: ['agriculture'],
    magnitude: 0.060, // +6.0%
    decayTicks: 50,
    probability: 0.004,
  },
  {
    id: 'EV_BRAZIL_FROST',
    title: '브라질 주요 커피 산지 기습 서리 피해',
    headline: '☕ [원두충격] 브라질 미나스제라이스 한파 습격… 커피 원두 수급 대란',
    description: '세계 최대 커피 생산지의 기습 냉해로 생두 가격이 폭등세를 보이고 있습니다.',
    targetCategories: ['agriculture'],
    targetCommodityIds: ['COFFEE'],
    magnitude: 0.080, // +8.0%
    decayTicks: 30,
    probability: 0.003,
  },

  // ── 3. 협약 및 카르텔 결정 (OPEC / Policy) ──
  {
    id: 'EV_OPEC_CUT',
    title: 'OPEC+ 산유국 전격 감산 합의 발표',
    headline: '🛢️ [공급조절] OPEC+ 하루 200만 배럴 기습 감산 합의… 공급 긴축 가속화',
    description: '주요 산유국들의 자발적 감산 연장으로 국제 유가가 강한 상방 압력을 받고 있습니다.',
    targetCategories: ['energy'],
    targetCommodityIds: ['CRUDE_OIL'],
    magnitude: 0.045, // +4.5%
    decayTicks: 30,
    probability: 0.005,
  },
  {
    id: 'EV_RECESSION_PMI_CRASH',
    title: '글로벌 제조업 PMI 급락 및 경기 침체 공포',
    headline: '📉 [실물위기] 글로벌 제조업 지수 10년래 최저… 원자재 수요 급랭',
    description: '주요 소비국의 공장 가동률 저하로 산업용 원자재와 에너지 수요 전망이 급격히 냉각되었습니다.',
    targetCategories: ['industrial_metals', 'energy'],
    magnitude: -0.040, // -4.0% 급락
    decayTicks: 45,
    probability: 0.004,
  },

  // ── 4. 산업금속 및 배터리 공급망 (EV / Metals) ──
  {
    id: 'EV_LITHIUM_MINE_STRIKE',
    title: '칠레·호주 주요 리튬 광산 파업 및 수출 통제',
    headline: '⚡ [배터리경보] 남미 리튬 광산 무기한 총파업… 2차전지 원가 비상',
    description: '환경 규제 및 임금 협상 결렬로 핵심 리튬 광산 채굴이 전면 중단되었습니다.',
    targetCategories: ['industrial_metals'],
    targetCommodityIds: ['LITHIUM'],
    magnitude: 0.075, // +7.5%
    decayTicks: 35,
    probability: 0.003,
  },
  {
    id: 'EV_COPPER_DISCOVERY',
    title: '남미 초대형 구리 광맥 신규 발견 및 공급 확대',
    headline: '⛏️ [자원개발] 세계 최대 규모 구리 매장지 발견… 중장기 공급 과잉 우려',
    description: '신규 광산 가동 계획 발표로 단기 구리 투기성 매수세가 대거 차익 실현으로 전환되었습니다.',
    targetCategories: ['industrial_metals'],
    targetCommodityIds: ['COPPER'],
    magnitude: -0.035, // -3.5%
    decayTicks: 25,
    probability: 0.003,
  },

  // ── 5. 전염병 및 축산물 (Livestock Epidemic) ──
  {
    id: 'EV_SWINE_FEVER',
    title: '아프리카 돼지열병(ASF) 글로벌 확산 조짐',
    headline: '🥩 [축산비상] 주요 사육 농가 전염병 확산… 돈육 도축량 급감',
    description: '가축 방역 격상 및 살처분 확대로 육류 시장 공급 부족이 현실화되고 있습니다.',
    targetCategories: ['livestock'],
    targetCommodityIds: ['LEAN_HOGS'],
    magnitude: 0.050, // +5.0%
    decayTicks: 35,
    probability: 0.003,
  },
];

export class CommodityEventSystem {
  public activeEvents: ActiveCommodityEvent[] = [];
  public newsFeed: CommodityNewsItem[] = [];
  private eventHistory: ActiveCommodityEvent[] = [];
  private globalTriggerProbability: number = 0.02; // 틱당 2% 확률

  constructor(triggerProbability?: number) {
    if (triggerProbability !== undefined) {
      this.globalTriggerProbability = triggerProbability;
    }
  }

  /**
   * 매 틱 이벤트 시스템 처리:
   * 1. 신규 이벤트 확률적 Draw
   * 2. 활성 이벤트 잔여 틱 감소 (Decay)
   * 3. 만료된 이벤트 정리
   */
  public tick(currentTick: number): {
    newEvents: ActiveCommodityEvent[];
    expiredEvents: ActiveCommodityEvent[];
    newNews: CommodityNewsItem[];
  } {
    const newEvents: ActiveCommodityEvent[] = [];
    const expiredEvents: ActiveCommodityEvent[] = [];
    const newNews: CommodityNewsItem[] = [];

    // 1. 신규 이벤트 추첨 (이미 활성화된 템플릿은 중복 제외)
    const activeTemplateIds = new Set(this.activeEvents.map((e) => e.templateId));
    const availableTemplates = EVENT_TEMPLATES.filter((t) => !activeTemplateIds.has(t.id));

    if (Math.random() < this.globalTriggerProbability && availableTemplates.length > 0) {
      // 템플릿 중 하나 랜덤 선택
      const selected = availableTemplates[Math.floor(Math.random() * availableTemplates.length)];

      if (selected) {
        const activeEvent: ActiveCommodityEvent = {
          id: `ev_${currentTick}_${selected.id}`,
          templateId: selected.id,
          title: selected.title,
          headline: selected.headline,
          targetCategories: selected.targetCategories,
          targetCommodityIds: selected.targetCommodityIds,
          magnitude: selected.magnitude,
          totalTicks: selected.decayTicks,
          remainingTicks: selected.decayTicks,
          startTick: currentTick,
        };

        this.activeEvents.push(activeEvent);
        this.eventHistory.push(activeEvent);
        newEvents.push(activeEvent);

        // 뉴스 피드 항목 생성
        const newsItem: CommodityNewsItem = {
          id: `news_${currentTick}_${selected.id}`,
          tick: currentTick,
          timestamp: Date.now(),
          category: selected.targetCategories.join(', '),
          title: selected.headline,
          content: selected.description,
          impactSentiment: selected.magnitude > 0 ? 'bullish' : 'bearish',
          affectedCommodities: selected.targetCommodityIds ?? selected.targetCategories,
        };

        this.newsFeed.unshift(newsItem);
        newNews.push(newsItem);
        if (this.newsFeed.length > 50) this.newsFeed.pop(); // 최대 50건 유지
      }
    }

    // 2. 활성 이벤트 틱 감소 및 만료 처리
    const remainingList: ActiveCommodityEvent[] = [];
    for (const ev of this.activeEvents) {
      ev.remainingTicks -= 1;
      if (ev.remainingTicks <= 0) {
        expiredEvents.push(ev);
      } else {
        remainingList.push(ev);
      }
    }
    this.activeEvents = remainingList;

    return { newEvents, expiredEvents, newNews };
  }

  /**
   * 수동 이벤트 강제 발동 (관리자 및 테스트용)
   */
  public triggerEventById(templateId: string, currentTick: number): ActiveCommodityEvent | null {
    const template = EVENT_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return null;

    const activeEvent: ActiveCommodityEvent = {
      id: `ev_manual_${currentTick}_${template.id}`,
      templateId: template.id,
      title: template.title,
      headline: template.headline,
      targetCategories: template.targetCategories,
      targetCommodityIds: template.targetCommodityIds,
      magnitude: template.magnitude,
      totalTicks: template.decayTicks,
      remainingTicks: template.decayTicks,
      startTick: currentTick,
    };

    this.activeEvents.push(activeEvent);
    this.eventHistory.push(activeEvent);

    const newsItem: CommodityNewsItem = {
      id: `news_manual_${currentTick}_${template.id}`,
      tick: currentTick,
      timestamp: Date.now(),
      category: template.targetCategories.join(', '),
      title: template.headline,
      content: template.description,
      impactSentiment: template.magnitude > 0 ? 'bullish' : 'bearish',
      affectedCommodities: template.targetCommodityIds || template.targetCategories,
    };
    this.newsFeed.unshift(newsItem);

    return activeEvent;
  }

  public clear(): void {
    this.activeEvents = [];
    this.newsFeed = [];
    this.eventHistory = [];
  }
}
