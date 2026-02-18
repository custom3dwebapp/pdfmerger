import os, io, json, base64, uuid
from flask import Flask, request, jsonify, send_file, render_template
from werkzeug.utils import secure_filename
import fitz  # PyMuPDF
from docx import Document as DocxDocument
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = '/home/user/uploads'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXT = {'pdf', 'docx'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXT

def docx_to_pdf(docx_path, pdf_path):
    doc = DocxDocument(docx_path)
    rl_doc = SimpleDocTemplate(pdf_path, pagesize=letter,
                               rightMargin=72, leftMargin=72,
                               topMargin=72, bottomMargin=72)
    styles = getSampleStyleSheet()
    story = []
    for para in doc.paragraphs:
        if para.text.strip():
            style = 'Heading1' if para.style.name.startswith('Heading') else 'Normal'
            story.append(Paragraph(para.text, styles[style]))
            story.append(Spacer(1, 0.1 * inch))
    for table in doc.tables:
        for row in table.rows:
            row_text = ' | '.join(cell.text.strip() for cell in row.cells)
            if row_text.strip():
                story.append(Paragraph(row_text, styles['Normal']))
                story.append(Spacer(1, 0.05 * inch))
    if not story:
        story.append(Paragraph('(empty document)', styles['Normal']))
    rl_doc.build(story)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    file = request.files['file']
    if not file or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type'}), 400

    original_name = secure_filename(file.filename)
    file_id = str(uuid.uuid4())
    ext = original_name.rsplit('.', 1)[1].lower()
    saved_path = os.path.join(app.config['UPLOAD_FOLDER'], f'{file_id}.{ext}')
    file.save(saved_path)

    final_path = saved_path
    if ext == 'docx':
        pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], f'{file_id}.pdf')
        docx_to_pdf(saved_path, pdf_path)
        final_path = pdf_path

    try:
        pdf = fitz.open(final_path)
        page_count = len(pdf)
        thumbnails = []
        for i in range(page_count):
            page = pdf[i]
            mat = fitz.Matrix(0.3, 0.3)
            pix = page.get_pixmap(matrix=mat)
            img_data = pix.tobytes('png')
            b64 = base64.b64encode(img_data).decode()
            thumbnails.append(f'data:image/png;base64,{b64}')
        pdf.close()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    return jsonify({
        'file_id': file_id,
        'original_name': original_name,
        'page_count': page_count,
        'thumbnails': thumbnails
    })

@app.route('/merge', methods=['POST'])
def merge():
    data = request.get_json()
    pages = data.get('pages', [])
    if not pages:
        return jsonify({'error': 'No pages selected'}), 400

    merger = fitz.open()
    for item in pages:
        file_id = item['file_id']
        page_idx = item['page_index']
        rotation = int(item.get('rotation', 0))

        pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], f'{file_id}.pdf')
        if not os.path.exists(pdf_path):
             # Fallback for original PDFs that didn't need conversion
             pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], f'{file_id}.pdf')

        try:
            src = fitz.open(pdf_path)
            merger.insert_pdf(src, from_page=page_idx, to_page=page_idx)
            src.close()
            merger[-1].set_rotation((merger[-1].rotation + rotation) % 360)
        except Exception as e:
            print(f"Error merging {file_id} page {page_idx}: {e}")
            continue

    out_buf = io.BytesIO()
    merger.save(out_buf)
    merger.close()
    out_buf.seek(0)
    return send_file(out_buf, mimetype='application/pdf',
                     as_attachment=True, download_name='foliocraft_merged.pdf')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)