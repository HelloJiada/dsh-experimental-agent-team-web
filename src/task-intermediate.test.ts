/**
 * 改进 4 服务端测试:任务中间态(blockedByReview / awaitingInput)纯函数
 * 与快照透出。覆盖 descriptionAwaitingInput 检测、taskBlockedByReview /
 * taskAwaitingInput 派生规则、终结状态兜底,以及 assembleTeamSnapshot 透出。
 */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleTeamSnapshot } from './snapshot.ts'
import {
  descriptionAwaitingInput,
  taskAwaitingInput,
  taskBlockedByReview,
} from './state.ts'
import type { TeamMember, TeamState, TeamTask } from './types.ts'

function member(name: string, overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: `session-${name}`,
    name,
    role: 'engineer',
    provider: 'p',
    model: 'm',
    joinedAt: 1000,
    status: 'idle',
    ...overrides,
  }
}

function task(id: string, overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id,
    subject: `任务${id}`,
    description: '描述',
    status: 'in_progress',
    assignee: '技术员',
    dependencies: [],
    attempt: 1,
    attemptId: `att-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function team(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: '中间态测试团队',
    id: 'team-intermediate',
    description: 'demo',
    captainSessionId: 'session-captain',
    createdAt: 1000,
    members: [
      member('政委', { role: 'commissar' }),
      member('技术员'),
    ],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

function context(): Context {
  return {
    agents: { get: () => undefined },
    logger: { warn: () => undefined, debug: () => undefined },
  } as unknown as Context
}

describe('descriptionAwaitingInput — 任务描述待确认问题检测', () => {
  it('空/缺省描述恒为 false', () => {
    expect(descriptionAwaitingInput(undefined)).toBe(false)
    expect(descriptionAwaitingInput('')).toBe(false)
    expect(descriptionAwaitingInput('   ')).toBe(false)
  })

  it('命中显式提示词(中文)判定为待输入', () => {
    expect(descriptionAwaitingInput('实现导出功能，待确认输出格式')).toBe(true)
    expect(descriptionAwaitingInput('待输入：目标平台列表')).toBe(true)
    expect(descriptionAwaitingInput('请确认优先级后开工')).toBe(true)
    expect(descriptionAwaitingInput('需要确认预算范围')).toBe(true)
  })

  it('命中显式提示词(英文,不区分大小写)', () => {
    expect(descriptionAwaitingInput('Implement export, awaiting input on format')).toBe(true)
    expect(descriptionAwaitingInput('Awaiting confirmation on scope')).toBe(true)
    expect(descriptionAwaitingInput('Please confirm the target platform')).toBe(true)
  })

  it('讨论框架概念(awaitingInput 术语)不误判为等待输入', () => {
    // 任务描述在阐述中间态概念本身,而非等待输入——不得命中无空格变体。
    expect(descriptionAwaitingInput('检查 awaitingInput 中间态流转是否完备')).toBe(false)
    expect(descriptionAwaitingInput('description awaitingInput on scope')).toBe(false)
    expect(descriptionAwaitingInput('对接 blockedByReview/awaitingInput 快照字段')).toBe(false)
  })

  it('独立成行的问号视为待确认问题', () => {
    expect(descriptionAwaitingInput('拆解接口清单\n?\n按模块推进')).toBe(true)
    expect(descriptionAwaitingInput('方案 A 或 B？\n？')).toBe(true)
  })

  it('普通疑问/说明不误判为待输入', () => {
    expect(descriptionAwaitingInput('这个功能要怎么做？详细拆解后开工')).toBe(false)
    expect(descriptionAwaitingInput('为什么这样做：见历史复盘')).toBe(false)
    expect(descriptionAwaitingInput('无前置，可立即开工')).toBe(false)
  })

  it('长技术描述中段提及"需要确认 X"属实现指令,不误判(t25 误标根因)', () => {
    // 1235 字符实现规格,第 970 字符处"需要确认金币包数据源"是给执行者的指令,
    // 不是等待队长输入的问题——不得判定为待输入。
    const longSpec = '修复三方支付弹窗金币包商品卡 "x coins + x vouchers" 文案消失。\n\n'
      + '背景：t18 后金币包在 StorePopupActivity 走订阅分支（setSubscriptionProductInfo）→ '
      + 'PaymentMethodDialog.productInfoMode=SUBSCRIPTION → bindProductInfo 里 isCoin=false → '
      + 'mBind.productContent.setVisibility(GONE)。结果：金币包商品卡只剩价格+优惠文案。\n\n'
      + '修复方案评估（需技术员确认最优）：\n方案 A：StorePopupActivity 订阅分支对金币包额外调 '
      + 'setCoinProductInfo 之后再 setSubscriptionProductInfo？\n方案 B：bindProductInfo 内对金币包特殊处理：'
      + '需要确认金币包商品在弹窗内的 coins/vouchers 数据源——StorePopupActivity 订阅分支没传，'
      + '但 product 有 getGoodCoin/getGoodGiving/getThirdGoodGiving。可在 bindProductInfo 金币包分支里用 '
      + 'product.getGoodCoin()/resolveVouchers(product) 填充 tv_product_coin/tv_product_vouchers。\n\n'
      + '请先读代码确认：\n1. bindProductInfo 完整逻辑与布局\n2. setCoinProductInfo 与 setSubscriptionProductInfo 的字段设置\n\n'
      + '完成后 diff 总结。'
    expect(descriptionAwaitingInput(longSpec)).toBe(false)
  })

  it('长描述中提示词位于前部(问题前置式)仍判定为待输入', () => {
    const leading = '待确认：目标平台是 Web 还是 CLI？\n\n'
      + '背景：实现导出功能涉及多端适配，需要先确定目标平台再规划其余步骤。'
      + '后续流程、接口、验收标准都依赖该平台选择，请队长确认后技术员再开工。'
    expect(descriptionAwaitingInput(leading)).toBe(true)
  })

  it('长描述中提示词后随冒号/问号(显式提问式)仍判定为待输入', () => {
    // 提示词出现在第 60 字符之后(不在前部窗口),但后随冒号/问号 → 显式提问式。
    const colon = '背景：金币包商品卡在订阅模式下只显示价格与优惠文案，'
      + 'coins 与 vouchers 区域被隐藏且无数据。用户期望恢复显示。'
      + '修复涉及 StorePopupActivity 与 PaymentMethodDialog 两处布局与数据流，'
      + '需先确认数据源归属，方案评估如下：\n\n'
      + '需要确认：金币包数据源是 goodCoin 还是 thirdGoodGiving？\n'
      + '其余按既定流程推进即可，仅此一项等队长/成员提供输入。'
    expect(descriptionAwaitingInput(colon)).toBe(true)
    const question = '背景：改造涉及两套支付弹窗，且订阅分支与内购分支共用同一弹窗布局，'
      + '字段互斥关系复杂，切换时会互相覆盖，需要先厘清 productInfoMode 与各 setter 的调用顺序，'
      + '避免方案选型在实现中途返工，相关讨论与历史决策见此前任务复盘，具体按以下方式推进：\n\n'
      + '请确认：优先级后开工？其余细节见附件，无其他阻塞。'
    expect(descriptionAwaitingInput(question)).toBe(true)
  })
})

describe('taskBlockedByReview — 等待政委复核中间态', () => {
  it('仅显式置位且非终结时判定为真', () => {
    expect(taskBlockedByReview(task('t1', { blockedByReview: true }))).toBe(true)
    expect(taskBlockedByReview(task('t1', { blockedByReview: false }))).toBe(false)
    expect(taskBlockedByReview(task('t1', {}))).toBe(false)
  })

  it('终结状态兜底清除(脏数据安全)', () => {
    expect(taskBlockedByReview(task('t1', {
      blockedByReview: true,
      status: 'completed',
      review: { reviewerName: '政委', verdict: 'pass', reviewedAt: 2000 },
    }))).toBe(false)
    expect(taskBlockedByReview(task('t1', { blockedByReview: true, status: 'failed' }))).toBe(false)
    expect(taskBlockedByReview(task('t1', { blockedByReview: true, status: 'cancelled' }))).toBe(false)
  })

  it('与门禁派生 reviewRequired 正交:reviewRequired 不隐含 blockedByReview', () => {
    expect(taskBlockedByReview(task('t1', { reviewRequired: true }))).toBe(false)
  })
})

describe('taskAwaitingInput — 等待输入中间态', () => {
  it('显式置位为真', () => {
    expect(taskAwaitingInput(task('t1', { awaitingInput: true }))).toBe(true)
    expect(taskAwaitingInput(task('t1', { awaitingInput: false }))).toBe(false)
  })

  it('旧任务免迁移:描述含待确认问题即派生为真', () => {
    expect(taskAwaitingInput(task('t1', { description: '待确认：目标平台' }))).toBe(true)
    expect(taskAwaitingInput(task('t1', { description: '正常描述' }))).toBe(false)
  })

  it('显式置位优先级:描述无提示词但已置位仍为真', () => {
    expect(taskAwaitingInput(task('t1', {
      awaitingInput: true,
      description: '正常描述',
    }))).toBe(true)
  })
})

describe('快照透出 — blockedByReview / awaitingInput', () => {
  let workspace: string
  let stateRoot: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'agent-team-intermediate-'))
    stateRoot = join(workspace, '.agent-team-web')
    await mkdir(join(stateRoot, 'team-intermediate', 'inbox'), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('中间态任务在快照中透出标记,其余任务不携带', async () => {
    const state = team({
      tasks: [
        task('t1', { blockedByReview: true, reviewRequired: true, riskLevel: 'high' }),
        task('t2', { awaitingInput: true }),
        task('t3', {}),
      ],
    })
    await writeFile(join(stateRoot, 'team-intermediate', 'team.json'), JSON.stringify(state, null, 2))
    const snapshot = await assembleTeamSnapshot(context(), stateRoot, 'w', state)
    const t1 = snapshot.tasks.find(t => t.id === 't1')
    const t2 = snapshot.tasks.find(t => t.id === 't2')
    const t3 = snapshot.tasks.find(t => t.id === 't3')
    expect(t1?.blockedByReview).toBe(true)
    expect(t2?.awaitingInput).toBe(true)
    expect(t3?.blockedByReview).toBeUndefined()
    expect(t3?.awaitingInput).toBeUndefined()
  })

  it('终结任务即使残留脏标记也不透出 blockedByReview', async () => {
    const state = team({
      tasks: [task('t1', {
        blockedByReview: true,
        status: 'completed',
        review: { reviewerName: '政委', verdict: 'pass', reviewedAt: 2000 },
      })],
    })
    await writeFile(join(stateRoot, 'team-intermediate', 'team.json'), JSON.stringify(state, null, 2))
    const snapshot = await assembleTeamSnapshot(context(), stateRoot, 'w', state)
    expect(snapshot.tasks[0]?.blockedByReview).toBeUndefined()
  })
})
