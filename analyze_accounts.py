#!/usr/bin/env python3
"""Analyze Antigravity Accounts"""
import json
import sqlite3
import os

def analyze():
    print("--- 1. Accounts.json ---")
    try:
        with open('accounts.json', 'r', encoding='utf-8') as f:
            accounts = json.load(f)
            
        print(f"Total Accounts: {len(accounts)}")
        for acc in accounts:
            print(f"ID: {acc.get('id')}")
            print(f"  Name: {acc.get('name')}")
            print(f"  Email: {acc.get('email')}")
            print(f"  Type: {acc.get('type')}")
            print(f"  Role: {acc.get('role')}")
            print(f"  Status: {acc.get('status')}")
            print(f"  Provider: {acc.get('provider')}") # if exists
            # Check for quota info inside account object or 'limits'
            if 'limits' in acc:
                print(f"  Limits: {acc['limits']}")
            print("-" * 20)
            
    except Exception as e:
        print(f"Error reading accounts.json: {e}")

    print("\n--- 2. Token Stats DB ---")
    if os.path.exists('token_stats.db'):
        try:
            conn = sqlite3.connect('token_stats.db')
            cursor = conn.cursor()
            
            # List tables
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            print(f"Tables: {tables}")
            
            # For each table, verify schema or dump relevant rows
            # Table names likely relate to accounts or tokens
            for table in tables:
                tname = table[0]
                print(f"\nTable: {tname}")
                # Get columns
                cursor.execute(f"PRAGMA table_info({tname})")
                cols = [c[1] for c in cursor.fetchall()]
                print(f"Columns: {cols}")
                
                # Sample data (limit 10)
                try:
                    cursor.execute(f"SELECT * FROM {tname} LIMIT 10")
                    rows = cursor.fetchall()
                    for r in rows:
                        print(r)
                except Exception as e:
                    print(f"Error querying table {tname}: {e}")
                    
            conn.close()
        except Exception as e:
            print(f"Error reading token_stats.db: {e}")
    else:
        print("token_stats.db not found locally.")

if __name__ == '__main__':
    analyze()
