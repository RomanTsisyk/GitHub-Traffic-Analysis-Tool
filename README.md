# GitHub Traffic Analysis Tool

## Overview

Tools for collecting and visualizing GitHub repository traffic statistics:

- **Web App** (`web-app/`) — a modern browser dashboard. Enter your GitHub Personal Access Token and get interactive charts of views, clones, traffic referrers, and more. Data stays local — nothing is sent to any server except the GitHub API.
- **Legacy Python Script** (`old py app/`) — the original CLI script that generates a text report (`github_traffic_report.txt`) and a static HTML dashboard (`dashboard.html`).

## Web App Features

- **Traffic Metrics:** Views and clones for the last 14 days, including daily breakdowns and unique counts
- **Private Repos:** Fetches all repositories your token can access, including private ones
- **Interactive Charts:** Responsive line charts with zoom & pan, clickable legends
- **Day of Week Analysis:** See which weekdays drive the most traffic
- **Traffic Referrers:** Where your visitors come from (top 5 repos, aggregated)
- **Search & Filter:** Filter charts by repository name or by views/clones
- **Export:** Download data as CSV or JSON, and save any chart as PNG
- **Dark Mode:** Full light/dark theme support
- **Smart Caching:** 30-minute local cache with automatic rate-limit retry handling
- **Privacy:** Your token and data are stored only in your browser's local storage

## Web App Usage

1. Open `web-app/index.html` in your browser
2. Create a [Personal Access Token](https://github.com/settings/tokens) with `repo` scope
3. Paste the token and click **Sign In**

No server or build step required — just open the file.

## Legacy Python Script

The original script is kept in `old py app/`:

1. Install dependencies:
   ```
   pip install requests rich pyperclip
   ```
2. Run the script:
   ```
   python3 old\ py\ app/github_traffic_report_v_1.0.py
   ```
3. Paste your PAT when prompted. The script generates:
   - A text report (`github_traffic_report.txt`)
   - An interactive HTML dashboard (`dashboard.html`)

## Live Demo

Open the generated dashboard or visit: [Live Dashboard](https://romantsisyk.github.io/GitHub-Traffic-Analysis-Tool/dashboard.html)

## Future Enhancements

- Additional UI improvements and customization options
- Extended analytics and metrics
- Integration with other platforms for broader insights

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome! Please open issues or submit pull requests for any improvements or feature suggestions.

## Contact

For inquiries, feedback, or collaboration opportunities, feel free to contact me on [LinkedIn](https://www.linkedin.com/in/roman-tsisyk/).

Enjoy analyzing your GitHub traffic and optimizing your projects!
