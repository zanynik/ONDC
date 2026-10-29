from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

OUT = Path("output/pdf")
OUT.mkdir(parents=True, exist_ok=True)

WINE = colors.HexColor("#642f38")
RED = colors.HexColor("#9d3038")
INK = colors.HexColor("#2a1716")
MUTED = colors.HexColor("#66524b")
SAND = colors.HexColor("#f4eee4")

pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DejaVu-Serif", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"))

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CoverLabel", parent=styles["Normal"], fontName="DejaVu-Bold", fontSize=9, leading=12, textColor=RED, alignment=TA_CENTER, spaceAfter=16))
styles.add(ParagraphStyle(name="CoverTitle", parent=styles["Title"], fontName="DejaVu-Serif", fontSize=32, leading=38, textColor=INK, alignment=TA_CENTER, spaceAfter=18))
styles.add(ParagraphStyle(name="CoverSub", parent=styles["Normal"], fontName="DejaVu", fontSize=10.5, leading=17, textColor=MUTED, alignment=TA_CENTER, spaceAfter=22))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="DejaVu-Serif", fontSize=20, leading=25, textColor=INK, spaceBefore=8, spaceAfter=12))
styles.add(ParagraphStyle(name="Body2", parent=styles["BodyText"], fontName="DejaVu", fontSize=9.5, leading=15, textColor=MUTED, spaceAfter=10))
styles.add(ParagraphStyle(name="ItemTitle", parent=styles["Heading3"], fontName="DejaVu-Bold", fontSize=10, leading=14, textColor=INK, spaceAfter=4))
styles.add(ParagraphStyle(name="Small", parent=styles["Normal"], fontName="DejaVu", fontSize=8.2, leading=12, textColor=MUTED))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#d9cfc1"))
    canvas.line(22 * mm, 17 * mm, 188 * mm, 17 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("DejaVu", 8)
    canvas.drawString(22 * mm, 11 * mm, "Zero Margin Food Systems Foundation | ONDC Retail B2C")
    canvas.drawRightString(188 * mm, 11 * mm, f"Page {doc.page}")
    canvas.restoreState()

def cover(title, subtitle, disclosure):
    return [
        Spacer(1, 38 * mm),
        Paragraph("ONDC BUYER APP PUBLIC DISCLOSURE", styles["CoverLabel"]),
        Paragraph(title, styles["CoverTitle"]),
        Paragraph(subtitle, styles["CoverSub"]),
        Table([["Organisation", "Zero Margin Food Systems Foundation"], ["Role", "Buyer NP - Retail (B2C)"], ["Domain", "ONDC:RET10 - Grocery"], ["Version", "0.1"], ["Effective date", "31 August 2026"], ["Disclosure", disclosure]], colWidths=[42*mm, 102*mm], style=TableStyle([
            ("BACKGROUND", (0,0), (0,-1), SAND), ("TEXTCOLOR", (0,0), (-1,-1), INK),
            ("FONTNAME", (0,0), (0,-1), "DejaVu-Bold"), ("FONTNAME", (1,0), (1,-1), "DejaVu"),
            ("FONTSIZE", (0,0), (-1,-1), 9), ("LEADING", (0,0), (-1,-1), 13),
            ("GRID", (0,0), (-1,-1), .5, colors.HexColor("#d2c5b6")), ("VALIGN", (0,0), (-1,-1), "TOP"),
            ("LEFTPADDING", (0,0), (-1,-1), 8), ("RIGHTPADDING", (0,0), (-1,-1), 8),
            ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7),
        ])),
        PageBreak(),
    ]

def build(path, story):
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=22*mm, leftMargin=22*mm, topMargin=22*mm, bottomMargin=24*mm, title=path.stem, author="Zero Margin Food Systems Foundation")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)

standards = [
    ("Legal and catalog eligibility", "The seller, store and item must be legally eligible and must not be rejected under ONDC's catalog and store rejection framework."),
    ("Protocol compliance", "The response must conform to the applicable ONDC protocol schema and contain the identifiers needed to continue the transaction."),
    ("Serviceability and availability", "The item must be shown as available and serviceable for the buyer's location at the time of search."),
    ("Minimum listing information", "The listing must include a usable item name, seller identity, price and currency. Material charges supplied by the seller are displayed before confirmation."),
    ("Consistent and fair application", "The same standards are applied consistently to all responding sellers. Zero Margin Food Systems Foundation does not sell ranking positions or favour affiliated sellers."),
]
story1 = cover("Minimum standards for displaying search results", "The uniform criteria used to decide which ONDC search responses may be shown to buyers.", "Buyer App Disclosure 1")
story1 += [Paragraph("1. Scope", styles["Section"]), Paragraph("These standards apply to search responses received by the Zero Margin Food buyer application for Retail B2C grocery discovery. A response must pass all applicable legal, protocol and published minimum-standard checks before sorting or display.", styles["Body2"]), Paragraph("2. Minimum standards", styles["Section"])]
for i, (title, text) in enumerate(standards, 1):
    story1 += [Paragraph(f"{i}. {title}", styles["ItemTitle"]), Paragraph(text, styles["Body2"])]
story1 += [Paragraph("3. Equal treatment", styles["Section"]), Paragraph("The standards are applied without regard to the seller's size, affiliation, or willingness to pay for placement. Paid placement is not currently offered. If the standards change, a new version and effective date will be published before use.", styles["Body2"]), Paragraph("4. Contact", styles["Section"]), Paragraph("Questions may be raised at https://ondc.zeroprofit.food/support or by calling/WhatsApp +91 99692 95759 during published support hours.", styles["Body2"])]
build(OUT / "buyer_app_disclosure_1.pdf", story1)

ranking = [
    ("Search relevance", "40%", "Match of item name, category and description to the buyer's query."),
    ("Total buyer price", "25%", "Lower total payable value, including disclosed delivery and other charges, ranks higher."),
    ("Estimated delivery time", "15%", "Shorter valid delivery estimates rank higher."),
    ("Distance", "10%", "Sellers closer to the buyer's delivery location rank higher."),
    ("Seller or product rating", "10%", "Higher network-provided ratings rank higher when comparable data exists."),
]
story2 = cover("Sorting parameters and relative importance", "The factors used to rank eligible ONDC search responses after minimum-standard checks.", "Buyer App Disclosure 2")
story2 += [Paragraph("1. Default sorting logic", styles["Section"]), Paragraph("Eligible results are ranked using the weighted factors below. Search relevance is the primary factor. Where a value is missing or cannot be compared reliably, it receives no preferential weight.", styles["Body2"])]
rows = [[Paragraph("Parameter", styles["ItemTitle"]), Paragraph("Weight", styles["ItemTitle"]), Paragraph("How it affects ranking", styles["ItemTitle"])]]
for title, weight, detail in ranking:
    rows.append([Paragraph(title, styles["Small"]), Paragraph(weight, styles["Small"]), Paragraph(detail, styles["Small"])])
story2 += [Table(rows, colWidths=[42*mm, 22*mm, 80*mm], repeatRows=1, style=TableStyle([
    ("BACKGROUND", (0,0), (-1,0), WINE), ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("GRID", (0,0), (-1,-1), .5, colors.HexColor("#d2c5b6")), ("VALIGN", (0,0), (-1,-1), "TOP"),
    ("LEFTPADDING", (0,0), (-1,-1), 7), ("RIGHTPADDING", (0,0), (-1,-1), 7),
    ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7),
]))]
story2 += [Paragraph("2. Buyer-controlled alternatives", styles["Section"]), Paragraph("The buyer-facing interface will provide reasonable alternatives to sort eligible results by total price, delivery time, distance, or rating. These choices operate only after the legal, protocol and minimum-standard filters.", styles["Body2"]), Paragraph("3. Commercial influence", styles["Section"]), Paragraph("Zero Margin Food Systems Foundation currently charges a 0% buyer-app finder fee and does not accept payment for search placement. Promoted results, if introduced later, will be clearly labelled and this disclosure will be updated before use.", styles["Body2"]), Paragraph("4. Contact", styles["Section"]), Paragraph("Questions may be raised at https://ondc.zeroprofit.food/support or by calling/WhatsApp +91 99692 95759 during published support hours.", styles["Body2"])]
build(OUT / "buyer_app_disclosure_2.pdf", story2)
