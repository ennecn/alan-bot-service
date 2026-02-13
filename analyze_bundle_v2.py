#!/usr/bin/env python3
"""Analyze Bundled Accounts Refined"""
import json
import sqlite3
import os
import datetime

def format_ts(ts):
    if not ts: return "Never"
    return datetime.datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M')

def analyze():
    # Load usage from DB
    usage_map = {} # email -> {'requests': 0, 'tokens': 0}
    if os.path.exists('token_stats.db'):
        try:
            conn = sqlite3.connect('token_stats.db')
            cursor = conn.cursor()
            cursor.execute("SELECT account_email, SUM(request_count), SUM(total_tokens) FROM token_stats_hourly GROUP BY account_email")
            rows = cursor.fetchall()
            for r in rows:
                usage_map[r[0]] = {'requests': r[1], 'tokens': r[2]}
            conn.close()
        except Exception as e:
            print(f"Error reading DB: {e}")

    # Process JSONs
    print(f"{'EMAIL':<30} | {'STATUS':<15} | {'USED_TOKS':<10} | {'LAST_USED':<16} | {'QUOTA_INFO'}")
    print("-" * 120)
    
    blocked_count = 0
    active_count = 0
    
    files = [f for f in os.listdir('accounts_extracted') if f.endswith('.json')]
    
    for fname in files:
        try:
            with open(os.path.join('accounts_extracted', fname), 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            email = data.get('email', 'N/A')
            
            # Determine Status
            status = "OK"
            if data.get('validation_blocked'):
                status = "BLOCKED"
                blocked_count += 1
            elif data.get('disabled'):
                status = "DISABLED"
            elif data.get('quota', {}).get('is_forbidden'):
                status = "FORBIDDEN"
                blocked_count += 1
            else:
                active_count += 1
            
            # Usage
            stats = usage_map.get(email, {'requests': 0, 'tokens': 0})
            
            # Last Used
            last_used = format_ts(data.get('last_used'))
            
            # Quota Info (Sample first model percentage if available)
            quota_info = ""
            models = data.get('quota', {}).get('models', [])
            if models:
                # Just show count of models and maybe first %
                q_summary = f"{len(models)} models"
                # Check for low percentage
                low = [m for m in models if m.get('percentage', 0) < 100]
                if low:
                     quota_info = f"Low: {', '.join([m['name'] for m in low])}"
                else:
                     quota_info = "All 100%"
            else:
                quota_info = "No quota info"

            print(f"{email:<30} | {status:<15} | {stats['tokens']:<10} | {last_used:<16} | {quota_info}")
            
        except Exception as e:
            print(f"Error parsing {fname}: {e}")

    print("-" * 120)
    print(f"Total: {len(files)}, Active: {active_count}, Blocked/Forbidden: {blocked_count}")

if __name__ == '__main__':
    analyze()
