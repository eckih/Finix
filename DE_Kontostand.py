import requests
import io
import zipfile
# XLSX ist ZIP - wir schauen uns die Sheet-Struktur an
url = 'https://www.bundesfinanzministerium.de/Datenportal/Daten/offene-daten/haushalt-oeffentliche-finanzen/Zeitreihe-Kredit-Bruttokredit-Tilgung-Zinsen/datensaetze/xlsx-Kreditbestand-Bruttokredit-Tilgung-Zinsen.xlsx?__blob=publicationFile&v=28'
r = requests.get(url, timeout=20)
try:
    import pandas as pd
    df = pd.read_excel(io.BytesIO(r.content), sheet_name=0, header=None)
    print('Shape:', df.shape)
    print(df.head(15).to_string())
except Exception as e:
    print('Error:', e)
    import subprocess
    subprocess.run(['pip', 'install', 'openpyxl', 'pandas', '-q'])
    import pandas as pd
    df = pd.read_excel(io.BytesIO(r.content), sheet_name=0, header=None)
    print('Shape:', df.shape)
    print(df.head(15).to_string())