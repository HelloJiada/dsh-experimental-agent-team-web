/**
 * Military-role display titles for member roles: canonical role keys stay
 * English in the data layer; the UI renders the localized title instead.
 * The preset catalog is the captain, the 7 behavioral executing roles
 * (researcher / engineer / qa / designer / data / docs / security), the task-level reviewer,
 * and the commissar. operator is not preset — it is a
 * custom role with no dedicated seat or behavior template — but its
 * display title is kept in the tables so legacy members and custom role
 * strings still resolve (降级 = 不出现在预设清单/协议/模板, 不是删除显示映射).
 * @module dsh-agent-team-web/client/roles
 */
import type { AgentTeamsLocaleKey, AgentTeamsTranslate } from './locales.ts';
/** Canonical role key → military-title locale key (see `role.*` in locales.ts).
 * Preset: captain + the 7 behavioral executing roles + reviewer + commissar.
 * operator is a compatibility entry for legacy members and
 * custom role strings (not preset, no dedicated seat or behavior template). */
export declare const ROLE_TITLE_KEY: Record<string, AgentTeamsLocaleKey>;
/**
 * Member role display title: canonical keys map to the localized military
 * title; anything unknown falls back to the raw role text (never blank,
 * never throws).
 */
export declare function roleTitle(role: string, t: AgentTeamsTranslate): string;
/**
 * Member name display title: when a member is named after a canonical role
 * key (or a display variant such as `engineer-v2`), show the localized
 * military title instead of the raw English key. Any other name (real
 * person, mailbox address, …) is returned unchanged — the data layer's
 * assignee matching and prompt identity keep using the original name.
 */
export declare function nameTitle(name: string, t: AgentTeamsTranslate): string;
/** True when the name itself is a canonical role name — the role title is
 * then already expressed by the name, so the role chip can be omitted.
 * Recognizes both plain role names (`技术员`, `engineer`) and auto-numbered
 * names (`技术员 一号`, legacy `技术员一号`). */
export declare function isRoleName(name: string): boolean;
/**
 * 角色职责说明表(t9 全量·气势版)——与 host members.ts ROLE_BEHAVIOR_TEMPLATES
 * 信息点对齐,但采用军事化/战略化中文措辞,用于设置页「查看」弹窗展示,
 * 让用户一眼感知角色的专业度与分工的严谨。
 */
export interface RoleDuty {
    readonly slogan: string;
    readonly steps: readonly {
        readonly title: string;
        readonly desc: string;
    }[];
    readonly deliverable: string;
    readonly rules: readonly string[];
}
/** 已知角色职责(查看弹窗展示);未知角色缺省为 undefined(弹窗不展示职责区)。 */
export declare const ROLE_DUTY: Readonly<Record<string, RoleDuty>>;
//# sourceMappingURL=roles.d.ts.map