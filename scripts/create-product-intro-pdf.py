from __future__ import annotations

from pathlib import Path

from PIL import Image
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SCREENS = ROOT / "tmp" / "pdfs" / "screens"
OUT = ROOT / "output" / "pdf" / "大湾区流浪者小程序产品介绍.pdf"
LOGO = ROOT / "src" / "assets" / "gba-crest-white.png"

W, H = landscape(A4)
NAVY = HexColor("#06133D")
ROYAL = HexColor("#123BB4")
BLUE = HexColor("#2D6DDB")
ICE = HexColor("#AFCBFF")
PAPER = HexColor("#F3F6FC")
INK = HexColor("#0A173A")
MUTED = HexColor("#63708D")
LINE = HexColor("#D9E2F2")
GREEN = HexColor("#168B57")
GOLD = HexColor("#B27B21")
RED = HexColor("#BE3B50")


def fonts() -> None:
    pdfmetrics.registerFont(TTFont("CN", r"C:\Windows\Fonts\msyh.ttc"))
    pdfmetrics.registerFont(TTFont("CN-Bold", r"C:\Windows\Fonts\msyhbd.ttc"))


def gradient(c: canvas.Canvas, top: str = "#06133D", bottom: str = "#2D6DDB") -> None:
    a, b = HexColor(top), HexColor(bottom)
    for i in range(100):
        t = i / 99
        color = Color(
            a.red + (b.red - a.red) * t,
            a.green + (b.green - a.green) * t,
            a.blue + (b.blue - a.blue) * t,
        )
        c.setFillColor(color)
        c.rect(0, i * H / 100, W, H / 100 + 1, fill=1, stroke=0)
    c.setFillColor(Color(0.55, 0.75, 1, alpha=0.10))
    c.circle(W - 60, H - 40, 180, fill=1, stroke=0)


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in text:
        if char == "\n":
            lines.append(current)
            current = ""
        elif pdfmetrics.stringWidth(current + char, font, size) <= width:
            current += char
        else:
            lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines


def paragraph(c: canvas.Canvas, text: str, x: float, y: float, width: float,
              size: float = 9, color=MUTED, leading: float = 14,
              font: str = "CN") -> float:
    c.setFont(font, size)
    c.setFillColor(color)
    for line in wrap(text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def rounded(c: canvas.Canvas, x: float, y: float, w: float, h: float,
            fill=white, stroke=LINE, radius: float = 14, shadow: bool = True) -> None:
    if shadow:
        c.setFillColor(Color(0.02, 0.08, 0.25, alpha=0.10))
        c.roundRect(x + 3, y - 4, w, h, radius, fill=1, stroke=0)
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def page_base(c: canvas.Canvas, page: int, section: str, dark: bool = False) -> None:
    if dark:
        gradient(c)
    else:
        c.setFillColor(PAPER)
        c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setFillColor(Color(0.12, 0.35, 0.85, alpha=0.06))
        c.circle(W - 30, H - 40, 170, fill=1, stroke=0)
    c.setFont("CN-Bold", 8)
    c.setFillColor(ICE if dark else ROYAL)
    c.drawString(36, H - 26, "大湾区流浪者  /  GBA RANGERS")
    c.setFont("CN", 7.5)
    c.setFillColor(Color(1, 1, 1, alpha=0.65) if dark else MUTED)
    c.drawRightString(W - 36, H - 26, section)
    c.setStrokeColor(Color(1, 1, 1, alpha=0.18) if dark else LINE)
    c.line(36, 24, W - 36, 24)
    c.setFont("CN", 7)
    c.setFillColor(Color(1, 1, 1, alpha=0.55) if dark else MUTED)
    c.drawString(36, 12, "真实运行界面展示  ·  2026.07")
    c.drawRightString(W - 36, 12, f"{page:02d}")


def page_title(c: canvas.Canvas, eyebrow: str, heading: str, subtitle: str,
               dark: bool = False) -> None:
    c.setFillColor(ICE if dark else ROYAL)
    c.setFont("CN-Bold", 8.5)
    c.drawString(48, H - 65, eyebrow)
    c.setFillColor(white if dark else INK)
    c.setFont("CN-Bold", 23)
    c.drawString(48, H - 96, heading)
    c.setFillColor(Color(1, 1, 1, alpha=0.70) if dark else MUTED)
    c.setFont("CN", 9.5)
    c.drawString(48, H - 117, subtitle)


def screen_path(name: str) -> Path:
    path = SCREENS / f"{name}.png"
    if not path.exists():
        raise FileNotFoundError(path)
    return path


def phone(c: canvas.Canvas, name: str, x: float, y: float, max_w: float,
          max_h: float, caption: str = "") -> tuple[float, float]:
    image = Image.open(screen_path(name)).convert("RGB")
    iw, ih = image.size
    scale = min((max_w - 10) / iw, (max_h - 10) / ih)
    dw, dh = iw * scale, ih * scale
    fw, fh = dw + 10, dh + 10
    fx, fy = x + (max_w - fw) / 2, y + (max_h - fh) / 2
    rounded(c, fx, fy, fw, fh, fill=HexColor("#101827"),
            stroke=Color(1, 1, 1, alpha=0.42), radius=16)
    c.drawImage(ImageReader(image), fx + 5, fy + 5, dw, dh,
                preserveAspectRatio=True, mask="auto")
    if caption:
        c.setFillColor(INK)
        c.setFont("CN-Bold", 8)
        c.drawCentredString(x + max_w / 2, y - 12, caption)
    return fw, fh


def module(c: canvas.Canvas, x: float, y: float, w: float, number: str,
           heading: str, body: str, accent=ROYAL) -> None:
    rounded(c, x, y, w, 72)
    c.setFillColor(accent)
    c.circle(x + 25, y + 46, 12, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("CN-Bold", 8)
    c.drawCentredString(x + 25, y + 43, number)
    c.setFillColor(INK)
    c.setFont("CN-Bold", 11)
    c.drawString(x + 46, y + 46, heading)
    paragraph(c, body, x + 18, y + 24, w - 36, 8.2, MUTED, 12)


def screenshot_page(c: canvas.Canvas, page: int, eyebrow: str, heading: str,
                    subtitle: str, left: tuple[str, str], right: tuple[str, str],
                    notes: list[tuple[str, str, object]], dark: bool = False) -> None:
    page_base(c, page, heading, dark)
    page_title(c, eyebrow, heading, subtitle, dark)
    phone(c, left[0], 46, 75, 180, 380, left[1])
    phone(c, right[0], 232, 75, 180, 380, right[1])
    nx = 445
    c.setFillColor(white if dark else INK)
    c.setFont("CN-Bold", 14)
    c.drawString(nx, 438, "页面内容")
    y = 346
    for i, (title_text, body, accent) in enumerate(notes, 1):
        module(c, nx, y, 340, f"{i:02d}", title_text, body, accent)
        y -= 88
    c.showPage()


def build() -> Path:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fonts()
    c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1)
    c.setTitle("大湾区流浪者小程序产品介绍")
    c.setAuthor("大湾区流浪者")
    c.setSubject("球队赛事与日常运营微信小程序真实界面展示")

    # 01 封面：直接以真实运行页面建立产品印象。
    gradient(c, "#04113F", "#174FC7")
    c.setFillColor(Color(1, 1, 1, alpha=0.07))
    c.roundRect(42, 40, W - 84, H - 80, 28, fill=1, stroke=0)
    c.setFillColor(ICE)
    c.setFont("CN-Bold", 10)
    c.drawString(66, H - 88, "GBA RANGERS  /  PRODUCT INTRODUCTION")
    c.setFillColor(white)
    c.setFont("CN-Bold", 32)
    c.drawString(66, H - 145, "大湾区流浪者")
    c.setFont("CN-Bold", 24)
    c.drawString(66, H - 185, "球队赛事与日常运营小程序")
    c.setFillColor(Color(1, 1, 1, alpha=0.72))
    c.setFont("CN", 11)
    c.drawString(66, H - 216, "真实页面全景展示  ·  产品功能介绍  ·  微信小程序交付版")
    if LOGO.exists():
        c.saveState()
        c.setFillAlpha(0.14)
        c.drawImage(str(LOGO), 60, 65, 230, 230, mask="auto", preserveAspectRatio=True)
        c.restoreState()
    phone(c, "02-match-center", 430, 95, 118, 340)
    phone(c, "08-players", 548, 74, 118, 340)
    phone(c, "13-admin-center", 666, 95, 118, 340)
    c.setFillColor(Color(1, 1, 1, alpha=0.62))
    c.setFont("CN", 8)
    c.drawString(66, 65, "界面截图来自当前项目 H5 运行版本，与微信小程序使用同一业务代码及视觉体系。")
    c.showPage()

    screenshot_page(
        c, 2, "CORE NAVIGATION", "双入口产品结构",
        "底部导航精简为“比赛”和“我的球队”，高频任务集中在两个主入口。",
        ("02-match-center", "比赛"), ("01-team-home", "我的球队"),
        [
            ("比赛中心", "查看近期赛事、报名状态、历史比赛，并进入赛事创建和排行榜。", ROYAL),
            ("我的球队", "集中管理通知、球员名册、数据榜单、球队年鉴和个人资料。", BLUE),
            ("统一视觉", "渐变蓝色背景结合半透明玻璃卡片，标题、层级和按钮保持一致。", NAVY),
        ],
    )

    screenshot_page(
        c, 3, "MATCH CENTER", "比赛中心与历史档案",
        "比赛首页承担赛前入口；赛事结果统一沉淀在历史比赛中。",
        ("02-match-center", "近期比赛"), ("03-match-history", "历史比赛"),
        [
            ("赛事报名", "显示开球时间、赛制、报名状态、已报名人数，并可直接进入详情。", ROYAL),
            ("历史比赛", "按时间展示已结束赛事、比分状态和出场人数，便于回顾。", GOLD),
            ("管理入口", "管理员可从比赛中心进入排行榜和赛事创建，减少操作层级。", NAVY),
        ],
    )

    screenshot_page(
        c, 4, "MATCH & REGISTRATION", "赛事详情与队内报名",
        "成员从详情了解队内信息，再完成参加、待定或缺席选择。",
        ("04-match-detail", "赛事详情"), ("05-match-signup", "赛事报名"),
        [
            ("队内信息", "集合时间、精确地点、费用和球衣要求仅向审核通过的成员开放。", ROYAL),
            ("三种状态", "参加、待定、缺席使用大尺寸选项，报名名单同步汇总。", BLUE),
            ("待定机制", "选择待定时补充确认截止时间，管理者可按时间发起提醒。", GREEN),
        ],
    )

    screenshot_page(
        c, 5, "TEAM SIGNAL", "球队通知与发布",
        "站内通知保存完整记录，管理员可按业务类型创建提醒。",
        ("06-notices", "通知动态"), ("07-notice-publish", "发布通知"),
        [
            ("赛事报名提醒", "关联具体赛事，提醒尚未完成报名的球队成员。", ROYAL),
            ("会费缴纳提醒", "支持填写金额、缴费周期与截止时间，统一传达财务事项。", GOLD),
            ("待定确认提醒", "面向仍处于待定状态的球员，推动阵容尽快确认。", RED),
        ],
    )

    screenshot_page(
        c, 6, "MEMBERSHIP", "球队主页与入队权限",
        "球员提交申请后，需要队长或管理员审核，才能使用球队内部功能。",
        ("01-team-home", "已认证成员主页"), ("16-join-review", "游客与入队申请"),
        [
            ("邀请加入", "访客填写真实姓名和球队邀请码，申请进入管理员审核队列。", ROYAL),
            ("身份分级", "访客、球员、管理员和队长拥有不同的查看及管理权限。", BLUE),
            ("信息保护", "报名名单、精确地点、费用和运营工具按成员身份开放。", NAVY),
        ],
    )

    # 07 球员名单单页，用更大的真实截图呈现完整分组。
    page_base(c, 7, "球员名册", True)
    page_title(c, "SQUAD", "按场上位置组织球员名册",
               "现役球员依次按前锋、中场、后卫、门将分组，并保留历史成员入口。", True)
    phone(c, "08-players", 50, 62, 258, 405)
    c.setFillColor(white)
    c.setFont("CN-Bold", 14)
    c.drawString(350, 432, "名单模块")
    position_cards = [
        ("前锋", "FORWARDS", "展示号码、赛季出场、进球和助攻。"),
        ("中场", "MIDFIELDERS", "沿用同一数据结构，便于横向查看。"),
        ("后卫", "DEFENDERS", "按位置建立清晰的阵容层级。"),
        ("门将", "GOALKEEPERS", "独立分组，支持后续扩展门将数据。"),
    ]
    for i, (cn, en, body) in enumerate(position_cards):
        x = 350 + (i % 2) * 220
        y = 286 - (i // 2) * 130
        rounded(c, x, y, 195, 102, fill=Color(1, 1, 1, alpha=0.12),
                stroke=Color(1, 1, 1, alpha=0.25), shadow=False)
        c.setFillColor(ICE)
        c.setFont("CN-Bold", 7.5)
        c.drawString(x + 18, y + 72, en)
        c.setFillColor(white)
        c.setFont("CN-Bold", 15)
        c.drawString(x + 18, y + 45, cn)
        paragraph(c, body, x + 18, y + 23, 160, 8, Color(1, 1, 1, alpha=0.68), 12)
    c.showPage()

    screenshot_page(
        c, 8, "PLAYER DATA", "球员档案与排行榜",
        "单人赛季数据、比赛记录和全队榜单均由真实比赛事实数据生成。",
        ("09-player-profile", "球员档案"), ("10-leaderboard", "排行榜"),
        [
            ("个人档案", "展示号码、位置、赛季出场、进球、助攻、公开资料和比赛记录。", ROYAL),
            ("三类榜单", "出场榜、射手榜、助攻榜支持切换，榜首采用视觉强调。", GOLD),
            ("数据来源", "赛后录入发布后更新个人档案及榜单，减少重复统计。", GREEN),
        ],
    )

    screenshot_page(
        c, 9, "THE YEARBOOK", "球队年鉴与比赛章节",
        "历史赛事持续形成球队年鉴，保留赛季进程、比分和照片沉淀空间。",
        ("11-yearbook", "年鉴列表"), ("12-yearbook-detail", "年鉴章节"),
        [
            ("赛季总览", "汇总全年比赛数量和出场人次，精选章节突出重要比赛。", ROYAL),
            ("比赛章节", "每场历史赛事形成独立章节，展示日期、比分、出场和赛况摘要。", BLUE),
            ("照片沉淀", "审核通过的赛事照片可进入章节，管理员控制精选及公开状态。", NAVY),
        ],
    )

    screenshot_page(
        c, 10, "TEAM OPERATIONS", "球队运营中心与成员审核",
        "队长和管理员通过统一后台处理通知、赛事、赛后数据及入队申请。",
        ("13-admin-center", "球队运营中心"), ("16-join-review", "申请与身份入口"),
        [
            ("运营概览", "待处理、待审核、任务和赛事草稿使用数据卡片集中呈现。", ROYAL),
            ("快捷操作", "发布通知、创建赛事、赛后录入和检查草稿均可直接进入。", BLUE),
            ("成员审核", "申请人进入审核队列，管理员完成通过、拒绝及球员档案绑定。", GREEN),
        ],
    )

    screenshot_page(
        c, 11, "MATCH OPERATIONS", "赛事创建与赛后录入",
        "后台覆盖赛前信息维护和赛后事实数据发布，形成完整业务闭环。",
        ("14-match-edit", "创建赛事"), ("15-post-match", "赛后数据"),
        [
            ("创建赛事", "维护对手、日期、时间、人数、区域、集合信息和内部备注。", ROYAL),
            ("发布控制", "支持保存草稿、发布赛事、截止报名及取消赛事等状态操作。", GOLD),
            ("赛后数据", "录入比分、实际出场、进球和助攻，发布后重算统计与年鉴。", GREEN),
        ],
    )

    c.save()
    return OUT


if __name__ == "__main__":
    print(build())
