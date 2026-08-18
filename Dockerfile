FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 在 Docker 映像檔建置階段直接解壓縮 land_data.db，確保容器啟動 0 延遲且資料 100% 完整更新
RUN python -c "import zipfile, os; print('[*] Build-time unzipping land_data.zip...'); zipfile.ZipFile('land_data.zip', 'r').extractall('.'); print('[*] Ready DB size:', os.path.getsize('land_data.db'))"

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT:-8080} --workers 2 --threads 4"]
