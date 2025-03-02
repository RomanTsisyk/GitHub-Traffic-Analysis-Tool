#!/usr/bin/env python3
"""
GitHub Traffic Statistics Script
Author: Roman Tsisyk
Date: 2025-02-16

Description:
  This script collects detailed traffic statistics for all your GitHub repositories.
  It uses the GitHub API to gather data on:
    - Views (last 14 days), including daily breakdown and unique visitors.
    - Clones (last 14 days), including daily breakdown and unique cloners.
    - Releases and downloads (if available).

  The script generates:
    - A text report saved to "github_traffic_report.txt".
    - An HTML dashboard ("dashboard.html") with interactive charts powered by Chart.js.
    - A modern UI with a professional look.
    
Usage:
  1. Copy your GitHub Personal Access Token (PAT) to your clipboard.
  2. Run this script and simply press Enter when prompted.
  3. Enjoy your report and interactive dashboard!
================================================================================

Enter your GitHub PAT (or press Enter to use clipboard):
"""

import os
import requests
import json
from collections import defaultdict
import getpass

# Optional: try to import pyperclip for clipboard support.
try:
    import pyperclip
except ImportError:
    print("pyperclip not found. Install it with 'pip install pyperclip' for clipboard support.")
    pyperclip = None

# --- Display Script Information ---
print("\n" + "=" * 80)
print("GitHub Traffic Statistics Script")
print("Author: Roman Tsisyk")
print("Date: 2025-02-16\n")
print("Description:")
print("  This script collects detailed traffic statistics for all your GitHub repositories.")
print("  It uses the GitHub API to gather data on:")
print("    - Views (last 14 days), including daily breakdown and unique visitors.")
print("    - Clones (last 14 days), including daily breakdown and unique cloners.")
print("    - Releases and downloads (if available).\n")
print("  The script generates:")
print('    - A text report saved to "github_traffic_report.txt".')
print('    - An HTML dashboard ("dashboard.html") with interactive charts powered by Chart.js.\n')
print("Usage:")
print("  1. Copy your GitHub Personal Access Token (PAT) to your clipboard.")
print("  2. Run this script and simply press Enter when prompted.")
print("  3. Enjoy your report and interactive dashboard!")
print("=" * 80 + "\n")

# --- Configuration via Console Input ---
token_input = getpass.getpass("Enter your GitHub PAT (or press Enter to use clipboard): ").strip()
if not token_input and pyperclip:
    token_input = pyperclip.paste().strip()
if not token_input:
    raise ValueError("No token provided. Please copy your GitHub PAT into the clipboard and try again.")
GITHUB_TOKEN = token_input

# Auto-detect GitHub username using the API (no manual input)
BASE_API_URL = "https://api.github.com"
HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github.v3+json"
}

try:
    resp = requests.get(f"{BASE_API_URL}/user", headers=HEADERS)
    resp.raise_for_status()
    user_info = resp.json()
    GITHUB_USER = user_info["login"]
    print(f"\nDetected GitHub username: {GITHUB_USER}\n")
except Exception as e:
    print(f"Error detecting user: {e}")
    exit(1)

# --- Helper Functions for Report Generation ---
def save_report_to_file(report, filename="github_traffic_report.txt"):
    """Saves the full report to a file (append mode)."""
    with open(filename, "a", encoding="utf-8") as file:
        file.write(report)
        file.write("\n\n")
    print(f"Report saved to '{filename}'.")

def get_user_repos(user, per_page=100):
    """Retrieves all repositories for the given user using simple pagination."""
    all_repos = []
    page = 1
    while True:
        url = f"{BASE_API_URL}/users/{user}/repos"
        params = {"per_page": per_page, "page": page}
        resp = requests.get(url, headers=HEADERS, params=params)
        resp.raise_for_status()
        repos = resp.json()
        if not repos:
            break
        all_repos.extend(repos)
        page += 1
    return all_repos

def get_repo_traffic_views(owner, repo):
    """Retrieves view statistics (last 14 days) for a repository."""
    url = f"{BASE_API_URL}/repos/{owner}/{repo}/traffic/views"
    resp = requests.get(url, headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

def get_repo_traffic_clones(owner, repo):
    """Retrieves clone statistics (last 14 days) for a repository."""
    url = f"{BASE_API_URL}/repos/{owner}/{repo}/traffic/clones"
    resp = requests.get(url, headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

def get_repo_releases(owner, repo):
    """Retrieves the list of releases for a repository."""
    url = f"{BASE_API_URL}/repos/{owner}/{repo}/releases"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    return resp.json()

def print_views_details(views_data):
    """Returns a string with daily view details (removes 'T00:00:00Z')."""
    report = ""
    for view in views_data.get("views", []):
        date = view["timestamp"].replace("T00:00:00Z", "")
        daily_views = view["count"]
        report += f"  * {date}: {daily_views} views\n"
    if not report:
        report = "  (No data available)\n"
    return report

def print_clones_details(clones_data):
    """Returns a string with daily clone details (removes 'T00:00:00Z')."""
    report = ""
    for clone in clones_data.get("clones", []):
        date = clone["timestamp"].replace("T00:00:00Z", "")
        daily_clones = clone["count"]
        report += f"  * {date}: {daily_clones} clones\n"
    if not report:
        report = "  (No data available)\n"
    return report

# --- Formatting for Console Output using Rich ---
from rich.console import Console
from rich.panel import Panel
from rich.progress import track
from rich.box import ROUNDED
from rich.text import Text

console = Console()

def format_repo_panel(repo_name, panel_text):
    """Formats a repository panel with rounded borders, word wrapping, and consistent padding."""
    wrapped_text = Text(panel_text, overflow="fold", no_wrap=False)
    return Panel(wrapped_text, title=f"[bold blue]{repo_name}[/bold blue]",
                 border_style="bright_blue", padding=(1, 2), expand=False, box=ROUNDED)

# --- Main Function ---
def main():
    console.rule("[bold blue]GitHub Traffic Report[/bold blue]")
    console.print(f"[bold]User:[/bold] {GITHUB_USER}\n", style="green")
    
    repos = get_user_repos(GITHUB_USER)
    if not repos:
        console.print("[red]No repositories found.[/red]")
        input("Press Enter to exit...")
        return

    full_report = ""
    # Containers for HTML dashboard data
    views_by_repo = {}   # { repo_name: { date: view_count } }
    clones_by_repo = {}  # { repo_name: { date: clone_count } }
    downloads_by_repo = {}  # { repo_name: total downloads }

    for r in track(repos, description="Processing repositories..."):
        repo_name = r["name"]
        full_name = r["full_name"]
        panel_text = f"[bold]Repository:[/bold] {full_name}\n"
        views_by_repo[repo_name] = {}
        clones_by_repo[repo_name] = {}
        downloads_by_repo[repo_name] = 0

        try:
            views_data = get_repo_traffic_views(GITHUB_USER, repo_name)
            clones_data = get_repo_traffic_clones(GITHUB_USER, repo_name)
            total_views = views_data.get("count", 0)
            unique_visitors = views_data.get("uniques", 0)
            total_clones = clones_data.get("count", 0)
            unique_cloners = clones_data.get("uniques", 0)

            panel_text += f"[cyan]Views (last 14 days):[/cyan] {total_views}\n"
            panel_text += f"[cyan]Unique Visitors:[/cyan] {unique_visitors}\n"
            panel_text += f"[magenta]Clones (last 14 days):[/magenta] {total_clones}\n"
            panel_text += f"[magenta]Unique Cloners:[/magenta] {unique_cloners}\n\n"

            panel_text += "[bold]Daily Views:[/bold]\n" + print_views_details(views_data)
            panel_text += "\n[bold]Daily Clones:[/bold]\n" + print_clones_details(clones_data)

            for view in views_data.get("views", []):
                date = view["timestamp"].replace("T00:00:00Z", "")
                views_by_repo[repo_name][date] = view["count"]
            for clone in clones_data.get("clones", []):
                date = clone["timestamp"].replace("T00:00:00Z", "")
                clones_by_repo[repo_name][date] = clone["count"]
        except requests.exceptions.HTTPError as e:
            panel_text += f"[red]Error retrieving traffic data: {e}[/red]\n"

        try:
            releases = get_repo_releases(GITHUB_USER, repo_name)
            if releases:
                panel_text += f"\n[bold]Releases:[/bold] {len(releases)}\n"
                for rel in releases:
                    rel_name = rel.get("name") or rel.get("tag_name")
                    assets = rel.get("assets", [])
                    if assets:
                        for asset in assets:
                            download_count = asset["download_count"]
                            panel_text += f"  * {rel_name} — Downloads: {download_count}\n"
                            downloads_by_repo[repo_name] += download_count
                    else:
                        panel_text += f"  * {rel_name} (no assets)\n"
            else:
                panel_text += "\n[italic]No releases or releases are hidden (404).[/italic]\n"
        except requests.exceptions.HTTPError as e:
            panel_text += f"[red]Could not retrieve releases: {e}[/red]\n"

        full_report += panel_text + "\n"
        # Insert a newline before printing the panel so the progress bar output is separated.
        console.print("")
        console.print(format_repo_panel(repo_name, panel_text))
    
    save_report_to_file(full_report)
    console.rule("[bold blue]Report Complete[/bold blue]")

    # --- Prepare Data for HTML Dashboard ---
    # Process Views Data
    all_view_dates = set()
    for repo_data in views_by_repo.values():
        all_view_dates.update(repo_data.keys())
    all_view_dates = sorted(all_view_dates)

    views_chart_data = {}
    for repo, data in views_by_repo.items():
        views_chart_data[repo] = [data.get(date, 0) for date in all_view_dates]

    overall_views = [0] * len(all_view_dates)
    for repo_data in views_chart_data.values():
        for i, count in enumerate(repo_data):
            overall_views[i] += count

    # Process Clones Data
    all_clone_dates = set()
    for repo_data in clones_by_repo.values():
        all_clone_dates.update(repo_data.keys())
    all_clone_dates = sorted(all_clone_dates)

    clones_chart_data = {}
    for repo, data in clones_by_repo.items():
        clones_chart_data[repo] = [data.get(date, 0) for date in all_clone_dates]

    overall_clones = [0] * len(all_clone_dates)
    for repo_data in clones_chart_data.values():
        for i, count in enumerate(repo_data):
            overall_clones[i] += count

    # --- Generate HTML Dashboard ---
    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GitHub Traffic Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {{
      font-family: 'Roboto', sans-serif;
      background: linear-gradient(135deg, #ece9e6, #ffffff);
      margin: 0;
      padding: 20px;
      color: #444;
    }}
    .container {{
      max-width: 1200px;
      margin: auto;
      background: #fff;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
      animation: fadeIn 1s ease-in-out;
    }}
    header {{
      text-align: center;
      margin-bottom: 40px;
    }}
    h1 {{
      font-size: 2.5em;
      margin-bottom: 10px;
      color: #222;
    }}
    h2 {{
      font-size: 1.8em;
      color: #333;
      margin-bottom: 20px;
    }}
    .chart-box {{
      position: relative;
      margin: 40px auto;
      height: 400px;
      width: 100%;
      max-width: 1000px;
    }}
    .section {{
      margin-bottom: 60px;
    }}
    @keyframes fadeIn {{
      from {{ opacity: 0; transform: translateY(10px); }}
      to {{ opacity: 1; transform: translateY(0); }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>GitHub Traffic Dashboard</h1>
      <p style="font-size: 1.2em; color: #666;">User: {GITHUB_USER}</p>
    </header>
    <div class="section">
      <h2>Daily Views per Repository</h2>
      <div class="chart-box">
        <canvas id="viewsCombinedChart"></canvas>
      </div>
      <h2 style="text-align:center; margin-top: 40px;">Overall Daily Views</h2>
      <div class="chart-box">
        <canvas id="viewsOverallChart"></canvas>
      </div>
    </div>
    <div class="section">
      <h2>Daily Clones per Repository</h2>
      <div class="chart-box">
        <canvas id="clonesCombinedChart"></canvas>
      </div>
      <h2 style="text-align:center; margin-top: 40px;">Overall Daily Clones</h2>
      <div class="chart-box">
        <canvas id="clonesOverallChart"></canvas>
      </div>
    </div>
  </div>
  <script>
    // Colors for datasets
    const colors = [
      "rgba(255, 99, 132, 1)",
      "rgba(54, 162, 235, 1)",
      "rgba(255, 206, 86, 1)",
      "rgba(75, 192, 192, 1)",
      "rgba(153, 102, 255, 1)",
      "rgba(255, 159, 64, 1)",
      "rgba(199, 199, 199, 1)",
      "rgba(83, 102, 255, 1)",
      "rgba(255, 99, 71, 1)",
      "rgba(60, 179, 113, 1)"
    ];

    // --- Views Charts ---
    const viewLabels = {json.dumps(all_view_dates)};
    const viewsChartData = {json.dumps(views_chart_data)};
    let viewsDatasets = [];
    let idx = 0;
    for (const repo in viewsChartData) {{
      viewsDatasets.push({{
        label: repo,
        data: viewsChartData[repo],
        fill: false,
        borderColor: colors[idx % colors.length],
        backgroundColor: colors[idx % colors.length],
        tension: 0.3,
        pointRadius: 4
      }});
      idx++;
    }}

    const ctxViewsCombined = document.getElementById('viewsCombinedChart').getContext('2d');
    new Chart(ctxViewsCombined, {{
      type: 'line',
      data: {{
        labels: viewLabels,
        datasets: viewsDatasets
      }},
      options: {{
        responsive: true,
        plugins: {{
          title: {{
            display: true,
            text: 'Daily Views per Repository'
          }},
          tooltip: {{
            mode: 'index',
            intersect: false
          }},
          legend: {{
            position: 'bottom'
          }}
        }},
        scales: {{
          x: {{
            title: {{
              display: true,
              text: 'Date'
            }}
          }},
          y: {{
            beginAtZero: true,
            title: {{
              display: true,
              text: 'Views'
            }}
          }}
        }}
      }}
    }});

    const overallViews = {json.dumps(overall_views)};
    const ctxViewsOverall = document.getElementById('viewsOverallChart').getContext('2d');
    new Chart(ctxViewsOverall, {{
      type: 'line',
      data: {{
        labels: viewLabels,
        datasets: [{{
          label: 'Overall Views',
          data: overallViews,
          fill: true,
          borderColor: 'rgba(0, 122, 204, 1)',
          backgroundColor: 'rgba(0, 122, 204, 0.2)',
          tension: 0.4,
          pointRadius: 6,
          pointBackgroundColor: 'rgba(0, 122, 204, 1)'
        }}]
      }},
      options: {{
        responsive: true,
        plugins: {{
          title: {{
            display: true,
            text: 'Overall Daily Views'
          }},
          tooltip: {{
            callbacks: {{
              label: function(context) {{
                return context.parsed.y + " views";
              }}
            }}
          }},
          legend: {{ display: false }}
        }},
        scales: {{
          x: {{
            title: {{
              display: true,
              text: 'Date'
            }}
          }},
          y: {{
            beginAtZero: true,
            title: {{
              display: true,
              text: 'Views'
            }}
          }}
        }}
      }}
    }});

    // --- Clones Charts ---
    const cloneLabels = {json.dumps(all_clone_dates)};
    const clonesChartData = {json.dumps(clones_chart_data)};
    let clonesDatasets = [];
    idx = 0;
    for (const repo in clonesChartData) {{
      clonesDatasets.push({{
        label: repo,
        data: clonesChartData[repo],
        fill: false,
        borderColor: colors[idx % colors.length],
        backgroundColor: colors[idx % colors.length],
        tension: 0.3,
        pointRadius: 4
      }});
      idx++;
    }}

    const ctxClonesCombined = document.getElementById('clonesCombinedChart').getContext('2d');
    new Chart(ctxClonesCombined, {{
      type: 'line',
      data: {{
        labels: cloneLabels,
        datasets: clonesDatasets
      }},
      options: {{
        responsive: true,
        plugins: {{
          title: {{
            display: true,
            text: 'Daily Clones per Repository'
          }},
          tooltip: {{
            mode: 'index',
            intersect: false
          }},
          legend: {{
            position: 'bottom'
          }}
        }},
        scales: {{
          x: {{
            title: {{
              display: true,
              text: 'Date'
            }}
          }},
          y: {{
            beginAtZero: true,
            title: {{
              display: true,
              text: 'Clones'
            }}
          }}
        }}
      }}
    }});

    const overallClones = {json.dumps(overall_clones)};
    const ctxClonesOverall = document.getElementById('clonesOverallChart').getContext('2d');
    new Chart(ctxClonesOverall, {{
      type: 'line',
      data: {{
        labels: cloneLabels,
        datasets: [{{
          label: 'Overall Clones',
          data: overallClones,
          fill: true,
          borderColor: 'rgba(0, 122, 204, 1)',
          backgroundColor: 'rgba(0, 122, 204, 0.2)',
          tension: 0.4,
          pointRadius: 6,
          pointBackgroundColor: 'rgba(0, 122, 204, 1)'
        }}]
      }},
      options: {{
        responsive: true,
        plugins: {{
          title: {{
            display: true,
            text: 'Overall Daily Clones'
          }},
          tooltip: {{
            callbacks: {{
              label: function(context) {{
                return context.parsed.y + " clones";
              }}
            }}
          }},
          legend: {{ display: false }}
        }},
        scales: {{
          x: {{
            title: {{
              display: true,
              text: 'Date'
            }}
          }},
          y: {{
            beginAtZero: true,
            title: {{
              display: true,
              text: 'Clones'
            }}
          }}
        }}
      }}
    }});
  </script>
</body>
</html>
"""

    try:
        with open("dashboard.html", "w", encoding="utf-8") as html_file:
            html_file.write(html_template)
        print("Dashboard generated as 'dashboard.html'.")
    except Exception as e:
        print(f"Error generating dashboard: {e}")

if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"Unexpected error: {err}")
    input("Press Enter to exit...")
