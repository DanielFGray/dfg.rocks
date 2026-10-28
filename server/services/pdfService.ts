import { Effect } from "effect";
import PDFDocument from "pdfkit";

export class PdfService extends Effect.Service<PdfService>()("PdfService", {
  accessors: true,
  sync: () => {
    function renderPdf(doc: PDFKit.PDFDocument): Effect.Effect<Buffer, Error> {
      return Effect.async<Buffer, Error>((resume) => {
        const chunks: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resume(Effect.succeed(Buffer.concat(chunks))));
        doc.on("error", (err: Error) => resume(Effect.fail(err)));
        doc.end();
      });
    }

    function buildBillDoc(params: {
      familyName: string;
      billNumber: number;
      status: string;
      billingPeriodStart: string;
      billingPeriodEnd: string;
      dueDate: string | null;
      lineItems: Array<{
        description: string;
        lineType: string;
        quantity: number;
        unitPriceCents: number;
        amountCents: number;
        studentName?: string;
      }>;
      subtotalCents: number;
      discountCents: number;
      taxCents: number;
      totalCents: number;
      issuedAt: string | null;
      paidAt: string | null;
      createdAt: string;
    }): PDFKit.PDFDocument {
      const doc = new PDFDocument({ margin: 50, size: "A4" });

      const { familyName, billNumber, status, billingPeriodStart, billingPeriodEnd, dueDate } = params;

      doc.fontSize(20).font("Helvetica-Bold").text("Bill", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica").fillColor("#666")
        .text(`Bill #${billNumber}`, { align: "center" })
        .moveDown(0.5);

      doc.fontSize(10).fillColor("#000");
      doc.text(`Family: ${familyName}`, 50, doc.y, { continued: false });
      doc.text(`Status: ${status.charAt(0).toUpperCase() + status.slice(1)}`);
      doc.text(`Period: ${billingPeriodStart} \u2013 ${billingPeriodEnd}`);
      if (dueDate) doc.text(`Due date: ${dueDate}`);
      doc.moveDown(0.5);

      const issuedLabel = params.issuedAt ? `Issued: ${params.issuedAt}` : "Not yet issued";
      const paidLabel = params.paidAt ? `Paid: ${params.paidAt}` : "";
      doc.text(issuedLabel);
      if (paidLabel) doc.text(paidLabel);
      doc.moveDown(1);

      const tableTop = doc.y;
      const colWidths = [160, 110, 50, 70, 70];
      const header = ["Description", "Type", "Qty", "Unit Price", "Amount"];

      doc.fontSize(9).font("Helvetica-Bold");
      let xPos = 50;
      for (let i = 0; i < header.length; i++) {
        doc.text(header[i], xPos, tableTop, { width: colWidths[i] });
        xPos += colWidths[i];
      }

      doc.moveDown(0.3);
      doc.fontSize(8).font("Helvetica");
      let rowY = doc.y;
      doc.rect(50, tableTop - 4, 490, rowY - tableTop + 2).stroke("#ccc");

      for (const li of params.lineItems) {
        if (rowY > 700) {
          doc.addPage();
          rowY = 50;
        }
        const label = li.studentName
          ? `${li.description} (${li.studentName})`
          : li.description;
        doc.text(label, 50, rowY, { width: 160 });
        doc.text(li.lineType.replace(/_/g, " "), 210, rowY, { width: 100 });
        doc.text(String(li.quantity), 320, rowY, { width: 40, align: "right" });
        doc.text(formatCentsShort(li.unitPriceCents), 370, rowY, { width: 60, align: "right" });
        doc.text(formatCentsShort(li.amountCents), 440, rowY, { width: 70, align: "right" });
        rowY += 18;
      }

      const lineY = rowY + 8;
      doc.rect(50, doc.y + 4, 490, lineY - doc.y - 2).stroke("#eee");

      doc.fontSize(9);

      doc.text("Subtotal", 370, rowY + 6, { width: 70, align: "right" });
      doc.text(formatCentsShort(params.subtotalCents), 440, rowY + 6, { width: 70, align: "right" });
      rowY += 16;

      if (params.discountCents > 0) {
        doc.text("Discount", 370, rowY, { width: 70, align: "right" });
        doc.text(`-${formatCentsShort(params.discountCents)}`, 440, rowY, { width: 70, align: "right" });
        rowY += 16;
      }

      if (params.taxCents > 0) {
        doc.text("Tax", 370, rowY, { width: 70, align: "right" });
        doc.text(formatCentsShort(params.taxCents), 440, rowY, { width: 70, align: "right" });
        rowY += 16;
      }

      doc.font("Helvetica-Bold");
      doc.text("Total", 370, rowY, { width: 70, align: "right" });
      doc.text(formatCentsShort(params.totalCents), 440, rowY, { width: 70, align: "right" });
      rowY += 20;

      doc.font("Helvetica").fontSize(8).fillColor("#999");
      doc.text(`Generated on ${new Date().toISOString().slice(0, 10)}`, 50, rowY);

      return doc;
    }

    function buildReceiptDoc(params: {
      familyName: string;
      paymentNumber: number;
      amountCents: number;
      method: string;
      reference: string | null;
      receivedAt: string;
      allocations: Array<{
        billNumber: number;
        amountCents: number;
      }>;
    }): PDFKit.PDFDocument {
      const doc = new PDFDocument({ margin: 50, size: "A4" });

      const { familyName, paymentNumber, amountCents, method, reference, receivedAt, allocations } = params;

      doc.fontSize(20).font("Helvetica-Bold").text("Payment Receipt", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica").fillColor("#666")
        .text(`Receipt #${paymentNumber}`, { align: "center" })
        .moveDown(0.5);

      doc.fontSize(10).fillColor("#000");
      doc.text(`Family: ${familyName}`);
      doc.text(`Amount: ${formatCentsShort(amountCents)}`);
      doc.text(`Method: ${method.replace(/_/g, " ")}`);
      if (reference) doc.text(`Reference: ${reference}`);
      doc.text(`Received: ${receivedAt}`);
      doc.moveDown(1);

      if (allocations.length > 0) {
        doc.fontSize(10).font("Helvetica-Bold").text("Applied to bills:");
        doc.moveDown(0.3);
        doc.fontSize(9).font("Helvetica");

        allocations.forEach((a) => {
          doc.text(`  Bill #${a.billNumber}: ${formatCentsShort(a.amountCents)}`);
        });
      }

      doc.moveDown(2);
      doc.fontSize(8).fillColor("#999");
      doc.text(`Generated on ${new Date().toISOString().slice(0, 10)}`);

      return doc;
    }

    function formatCentsShort(cents: number): string {
      const dollars = (cents / 100).toFixed(2);
      return `$${dollars}`;
    }

    return {
      generateBillPdf: Effect.fn("generateBillPdf")((params: Parameters<typeof buildBillDoc>[0]) =>
        renderPdf(buildBillDoc(params)),
      ),
      generateReceiptPdf: Effect.fn("generateReceiptPdf")((params: Parameters<typeof buildReceiptDoc>[0]) =>
        renderPdf(buildReceiptDoc(params)),
      ),
    };
  },
}) {}
