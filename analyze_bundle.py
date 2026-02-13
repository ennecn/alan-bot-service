#!/usr/bin/env python3
"""Analyze Bundled Accounts"""
import tarfile
import json
import sqlite3
import os
import shutil

def analyze():
    # Extract
    if os.path.exists('accounts_extracted'):
        shutil.rmtree('accounts_extracted')
    os.makedirs('accounts_extracted')
    
    try:
        with tarfile.open('accounts.tar.gz', 'r:gz') as tar:
            tar.extractall('accounts_extracted')
    except Exception as e:
        print(f"Error extracting tar: {e}")
        return

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
    print(f"{'EMAIL':<35} | {'TYPE':<10} | {'STATUS':<10} | {'REQ':<5} | {'TOKENS':<8} | {'LIMITS'}")
    print("-" * 100)
    
    for fname in os.listdir('accounts_extracted'):
        if not fname.endswith('.json'):
            continue
            
        try:
            with open(os.path.join('accounts_extracted', fname), 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            email = data.get('email', 'N/A')
            atype = data.get('type', 'N/A')
            status = data.get('status', 'N/A')
            limits = data.get('limits', {})
            
            # Get usage
            stats = usage_map.get(email, {'requests': 0, 'tokens': 0})
            
            print(f"{email:<35} | {atype:<10} | {status:<10} | {stats['requests']:<5} | {stats['tokens']:<8} | {limits}")
            
        except Exception as e:
            print(f"Error parsing {fname}: {e}")

if __name__ == '__main__':
    analyze()
