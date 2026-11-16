"""Builds Pare's example PDF: a made-up four-page market report with running
headers, page numbers, headings, lists, and one chart drawn as a picture."""
import io
import sys

from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Image as RLImage, ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

out = sys.argv[1]

body = ParagraphStyle("body", fontName="Times-Roman", fontSize=11, leading=15, spaceAfter=9)
h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=22, leading=27, spaceAfter=14)
h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=15, leading=19, spaceBefore=10, spaceAfter=8)
note = ParagraphStyle("note", parent=body, fontSize=9, leading=12, textColor="#555555")


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8.5)
    canvas.setFillColor("#666666")
    canvas.drawString(inch, letter[1] - 0.6 * inch, "Harbor Coffee Co. · Specialty Coffee Market Report 2026 · Example document")
    canvas.drawRightString(letter[0] - inch, 0.55 * inch, f"Page {doc.page}")
    canvas.drawString(inch, 0.55 * inch, "Confidential: made up for demonstration")
    canvas.restoreState()


def chart():
    img = Image.new("RGB", (900, 420), "white")
    d = ImageDraw.Draw(img)
    vals = [("2022", 41), ("2023", 47), ("2024", 55), ("2025", 61), ("2026", 70)]
    d.line((80, 360, 860, 360), fill="#333333", width=2)
    for i, (label, v) in enumerate(vals):
        x = 120 + i * 150
        d.rectangle((x, 360 - v * 4.5, x + 90, 360), fill="#6250d6")
        d.text((x + 30, 370), label, fill="#333333")
        d.text((x + 33, 360 - v * 4.5 - 18), f"{v}%", fill="#333333")
    d.text((80, 20), "Share of cafes offering single-origin pour-over", fill="#333333")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    return RLImage(buf, width=6 * inch, height=2.8 * inch)


def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, body), leftIndent=12) for t in items], bulletType="bullet", start="•", leftIndent=14)


P = lambda t: Paragraph(t, body)
story = [
    Paragraph("Specialty Coffee in Mid-Sized Cities", h1),
    P("Harbor Coffee Co. is a made-up roaster, and every figure in this report is invented. It exists so that Pare has a realistic document to work on: a report with running headers, page numbers, headings, lists and a chart, the kind of PDF people often hand to Claude."),
    Paragraph("Summary", h2),
    P("Demand for specialty coffee in cities of 200,000 to 800,000 people grew faster than in the largest metros for the third year running. Independent cafes gained share from national chains, mostly on the strength of single-origin drinks and roasting done on site. Margins, however, came under pressure as green coffee prices stayed high through most of the year and wages rose in every market we track."),
    P("We expect growth to continue at a slower pace. The cafes best placed for the next two years are those that buy directly from a small number of farms, sell beans by the bag alongside drinks, and keep their menus short enough to train new staff in a week."),
    Paragraph("Key findings", h2),
    bullets([
        "Independent cafes now account for an estimated 38% of specialty coffee sales in mid-sized cities, up from 31% two years ago.",
        "Average spending per visit rose 6%, while visits per customer were flat; the gain came from price, not frequency.",
        "Retail bean sales grew twice as fast as drink sales at cafes that roast their own coffee.",
        "Staff turnover remains the most-cited operating problem, ahead of rent and green coffee prices.",
    ]),
    Paragraph("Market size and growth", h2),
    P("Across the fourteen cities in our sample, specialty coffee sales reached an estimated $1.9 billion this year, a rise of 8.4% on the year before. The largest metros grew 5.1% over the same period. The gap has narrowed slightly since last year, when it stood at more than four percentage points, but it has now persisted for three consecutive years, which suggests something more durable than a rebound after the pandemic."),
    P("Several forces explain the difference. Rents in mid-sized cities are lower, which lets owners open larger cafes with room to roast. Many of these cities have added university and hospital jobs, which bring a steady weekday crowd. And residents who moved from larger metros have brought their coffee habits with them, along with a willingness to pay more for a well-made cup than long-time residents typically did."),
    P("Growth was not even. Cities with a large university grew fastest, at more than 11%, while those that depend on manufacturing employment grew at roughly the national rate. Two cities in the sample shrank slightly, both after the closure of a large local employer."),
    Paragraph("Consumers", h2),
    P("The typical specialty coffee customer in our survey visits a cafe 3.2 times a week and spends $6.40 per visit. Younger customers visit more often but spend less each time; customers over 45 visit less often but are more likely to buy beans to brew at home. Asked what would make them switch cafes, most respondents named quality first and convenience second. Price came a distant third, which helps explain why cafes were able to raise prices this year without losing visits."),
    P("Interest in single-origin coffee continued to rise. The chart below shows the share of cafes in our sample that offer at least one single-origin pour-over on their regular menu, which has climbed every year since we began tracking it."),
    chart(),
    Paragraph("Figure 1. Share of cafes offering single-origin pour-over, 2022 to 2026. Invented figures.", note),
    Paragraph("Costs and margins", h2),
    P("Green coffee prices fell from their peak early in the year but finished well above their five-year average. Cafes that buy on contract, rather than on the spot market, were partly shielded, and those that buy directly from farms reported the most stable costs of all, though often at a higher base price. Dairy and alternative milks rose modestly, and paper goods were flat."),
    P("Labor was the larger story. Average hourly pay for baristas in our sample rose 7%, and most owners expect a similar increase next year. Combined with higher rents in the most popular neighborhoods, this pushed the median operating margin down from 9% to 7.5%. Cafes that sell beans by the bag held up best, because retail sales carry a higher margin and need little extra labor."),
    Paragraph("Outlook", h2),
    P("We expect specialty coffee sales in mid-sized cities to grow between 5% and 7% next year. Three risks could push the figure lower: a renewed rise in green coffee prices, a slowdown in hiring at universities and hospitals, and a wave of new openings that splits customers among more cafes than the market can support."),
    P("For owners, the priorities are familiar but sharper than before:"),
    bullets([
        "Lock in green coffee on contract where possible, and build direct relationships with two or three farms.",
        "Grow retail bean sales, which protect margins when drink prices can’t rise further.",
        "Keep menus short, so new staff can be trained quickly and turnover costs less.",
        "Watch new openings nearby, and compete on quality before price.",
    ]),
    Paragraph("Method", h2),
    P("This report combines a survey of 1,240 coffee drinkers, interviews with 52 cafe owners, and point-of-sale data shared by 87 cafes across fourteen cities. All of it is invented for this example, and any resemblance to a real company or report is a coincidence."),
]

doc = SimpleDocTemplate(out, pagesize=letter, leftMargin=inch, rightMargin=inch, topMargin=inch, bottomMargin=inch,
                        title="Specialty Coffee in Mid-Sized Cities", author="Harbor Coffee Co. (fictional)")
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
