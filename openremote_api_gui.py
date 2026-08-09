import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import json
import ssl
import http.client
import urllib.parse
import threading
import subprocess
import os

class OpenRemoteAPI:
    def __init__(self, host, username, password, realm="master"):
        self.host = host
        self.username = username
        self.password = password
        self.realm = realm
        self.token = None
        self.ctx = ssl._create_unverified_context()

    def authenticate(self):
        try:
            conn = http.client.HTTPSConnection(self.host, context=self.ctx, timeout=10)
            body = urllib.parse.urlencode({
                'client_id': 'openremote',
                'username': self.username,
                'password': self.password,
                'grant_type': 'password'
            })
            headers = {'Content-Type': 'application/x-www-form-urlencoded'}
            conn.request('POST', f'/auth/realms/{self.realm}/protocol/openid-connect/token', body, headers)
            resp = conn.getresponse()
            if resp.status == 200:
                data = json.loads(resp.read())
                self.token = data.get('access_token')
                return True, "Success"
            else:
                return False, f"HTTP {resp.status}: {resp.read().decode()}"
        except Exception as e:
            return False, str(e)

    def get_provisioning_rules(self):
        if not self.token:
            return False, "Not authenticated"
        try:
            conn = http.client.HTTPSConnection(self.host, context=self.ctx, timeout=10)
            headers = {'Authorization': f'Bearer {self.token}', 'Accept': 'application/json'}
            conn.request('GET', '/api/master/provisioning', headers=headers)
            resp = conn.getresponse()
            if resp.status == 200:
                return True, json.loads(resp.read().decode())
            else:
                return False, f"HTTP {resp.status}: {resp.read().decode()}"
        except Exception as e:
            return False, str(e)

    def update_provisioning_rule(self, rule_id, rule_data):
        if not self.token:
            return False, "Not authenticated"
        try:
            conn = http.client.HTTPSConnection(self.host, context=self.ctx, timeout=10)
            headers = {
                'Authorization': f'Bearer {self.token}',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
            conn.request('PUT', f'/api/master/provisioning/{rule_id}', body=json.dumps(rule_data), headers=headers)
            resp = conn.getresponse()
            if resp.status in (200, 204):
                return True, "Update successful"
            else:
                return False, f"HTTP {resp.status}: {resp.read().decode()}"
        except Exception as e:
            return False, str(e)

class AutoProvisioningWindow(tk.Toplevel):
    def __init__(self, master, api):
        super().__init__(master)
        self.title("Auto-Provisioning CA Manager")
        self.geometry("800x500")
        self.api = api
        self.rules = []
        self.setup_ui()
        self.load_rules()

    def setup_ui(self):
        left_frame = ttk.Frame(self)
        left_frame.pack(side="left", fill="y", padx=10, pady=10)

        ttk.Button(left_frame, text="Refresh Rules", command=self.load_rules).pack(fill="x", pady=(0, 10))

        self.rule_listbox = tk.Listbox(left_frame, width=30, height=25)
        self.rule_listbox.pack(fill="y", expand=True)
        self.rule_listbox.bind('<<ListboxSelect>>', self.on_rule_select)

        right_frame = ttk.LabelFrame(self, text="Rule Details & Actions", padding="10")
        right_frame.pack(side="right", fill="both", expand=True, padx=10, pady=10)

        self.detail_text = tk.Text(right_frame, wrap="word", state="disabled", height=15)
        self.detail_text.pack(fill="both", expand=True, pady=(0, 10))

        action_frame = ttk.Frame(right_frame)
        action_frame.pack(fill="x")

        self.update_ca_btn = ttk.Button(action_frame, text="Update CA Certificate (PEM)", state="disabled", command=self.do_update_ca)
        self.update_ca_btn.pack(side="left", padx=5)

    def load_rules(self):
        self.rule_listbox.delete(0, tk.END)
        self.rule_listbox.insert(tk.END, "Loading...")
        
        def _load():
            success, data = self.api.get_provisioning_rules()
            self.after(0, self.on_rules_loaded, success, data)
        threading.Thread(target=_load, daemon=True).start()

    def on_rules_loaded(self, success, data):
        self.rule_listbox.delete(0, tk.END)
        if success:
            self.rules = data
            for r in self.rules:
                self.rule_listbox.insert(tk.END, r.get('name', 'Unknown'))
        else:
            self.rules = []
            messagebox.showerror("Error", f"Failed to load rules:\n{data}")

    def on_rule_select(self, event):
        selection = self.rule_listbox.curselection()
        if not selection:
            self.update_ca_btn.config(state="disabled")
            return
        idx = selection[0]
        rule = self.rules[idx]
        
        self.detail_text.config(state="normal")
        self.detail_text.delete(1.0, tk.END)
        self.detail_text.insert(tk.END, f"Name: {rule.get('name')}\n")
        self.detail_text.insert(tk.END, f"ID: {rule.get('id')}\n")
        
        try:
            template = json.loads(rule.get('assetTemplate', '{}'))
            self.detail_text.insert(tk.END, f"Asset Type: {template.get('type', 'Unknown')}\n\n")
            current_ca = rule.get('data', {}).get('CACertPEM')
            if current_ca:
                self.detail_text.insert(tk.END, f"CA Configured: YES\n")
            else:
                self.detail_text.insert(tk.END, f"CA Configured: NO\n")
        except:
            self.detail_text.insert(tk.END, "Invalid Asset Template JSON.\n")
            
        self.detail_text.config(state="disabled")
        self.update_ca_btn.config(state="normal")
        self.selected_rule = rule

    def do_update_ca(self):
        filepath = filedialog.askopenfilename(title="Select CA Certificate", filetypes=(("PEM Files", "*.pem"), ("All Files", "*.*")))
        if not filepath: return
        try:
            with open(filepath, 'r') as f: ca_pem = f.read()
        except Exception as e:
            messagebox.showerror("Error", f"Could not read file:\n{e}")
            return

        rule = self.selected_rule
        if not messagebox.askyesno("Confirm", f"Update CA Certificate for '{rule.get('name')}'?"): return

        rule['data'] = rule.get('data', {})
        rule['data']['CACertPEM'] = ca_pem
        
        def _update():
            success, msg = self.api.update_provisioning_rule(rule['id'], rule)
            self.after(0, lambda: messagebox.showinfo("Result", "Updated successfully!" if success else f"Failed: {msg}"))
            self.after(0, self.load_rules)
        threading.Thread(target=_update, daemon=True).start()

class AssetTemplateEditorWindow(tk.Toplevel):
    def __init__(self, master, api):
        super().__init__(master)
        self.title("Asset Template Editor")
        self.geometry("900x600")
        self.api = api
        self.rules = []
        self.setup_ui()
        self.load_rules()

    def setup_ui(self):
        left_frame = ttk.Frame(self)
        left_frame.pack(side="left", fill="y", padx=10, pady=10)

        ttk.Button(left_frame, text="Refresh Rules", command=self.load_rules).pack(fill="x", pady=(0, 10))

        self.rule_listbox = tk.Listbox(left_frame, width=30, height=25)
        self.rule_listbox.pack(fill="y", expand=True)
        self.rule_listbox.bind('<<ListboxSelect>>', self.on_rule_select)

        right_frame = ttk.LabelFrame(self, text="Edit Asset Template JSON", padding="10")
        right_frame.pack(side="right", fill="both", expand=True, padx=10, pady=10)

        self.json_text = tk.Text(right_frame, wrap="none", font=("Courier", 10), bg="#f8f9fa", fg="#212529", bd=2, relief="sunken")
        self.json_text.pack(fill="both", expand=True, pady=(0, 10))
        self.json_text.insert(1.0, "Select a provisioning rule from the left panel to view and edit its Asset Template JSON here...")

        btn_frame = ttk.Frame(right_frame)
        btn_frame.pack(fill="x")
        
        self.format_btn = ttk.Button(btn_frame, text="Format JSON", state="disabled", command=self.do_format_json)
        self.format_btn.pack(side="left", padx=5)

        self.save_btn = ttk.Button(btn_frame, text="Save Template JSON", state="disabled", command=self.do_save_json)
        self.save_btn.pack(side="right", padx=5)

    def load_rules(self):
        self.rule_listbox.delete(0, tk.END)
        def _load():
            success, data = self.api.get_provisioning_rules()
            self.after(0, self.on_rules_loaded, success, data)
        threading.Thread(target=_load, daemon=True).start()

    def on_rules_loaded(self, success, data):
        self.rule_listbox.delete(0, tk.END)
        if success:
            self.rules = data
            for r in self.rules:
                self.rule_listbox.insert(tk.END, r.get('name', 'Unknown'))

    def on_rule_select(self, event):
        selection = self.rule_listbox.curselection()
        if not selection:
            self.save_btn.config(state="disabled")
            return
        idx = selection[0]
        rule = self.rules[idx]
        self.selected_rule = rule
        
        self.json_text.delete(1.0, tk.END)
        try:
            template = json.loads(rule.get('assetTemplate', '{}'))
            self.json_text.insert(tk.END, json.dumps(template, indent=4))
            self.save_btn.config(state="normal")
            self.format_btn.config(state="normal")
        except:
            self.json_text.insert(tk.END, rule.get('assetTemplate', ''))
            self.save_btn.config(state="normal")
            self.format_btn.config(state="disabled")

    def do_format_json(self):
        content = self.json_text.get(1.0, tk.END).strip()
        try:
            parsed = json.loads(content)
            self.json_text.delete(1.0, tk.END)
            self.json_text.insert(tk.END, json.dumps(parsed, indent=4))
        except Exception as e:
            messagebox.showerror("Invalid JSON", f"Cannot format. JSON syntax error:\n{e}")

    def do_save_json(self):
        new_json = self.json_text.get(1.0, tk.END).strip()
        try:
            json.loads(new_json) # validate JSON
        except Exception as e:
            messagebox.showerror("Invalid JSON", f"JSON syntax error:\n{e}")
            return
            
        rule = self.selected_rule
        rule['assetTemplate'] = new_json
        
        def _update():
            success, msg = self.api.update_provisioning_rule(rule['id'], rule)
            self.after(0, lambda: messagebox.showinfo("Result", "Template updated successfully!" if success else f"Failed: {msg}"))
        threading.Thread(target=_update, daemon=True).start()


class CertGeneratorWindow(tk.Toplevel):
    def __init__(self, master):
        super().__init__(master)
        self.title("Certificate Generator")
        self.geometry("500x300")
        self.setup_ui()

    def setup_ui(self):
        frame = ttk.Frame(self, padding="20")
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="Generate CA for a new Device Type", font=("Arial", 12, "bold")).pack(pady=(0,20))

        ttk.Label(frame, text="Device Type (e.g. sensor, flite):").pack(anchor="w")
        self.type_var = tk.StringVar()
        ttk.Entry(frame, textvariable=self.type_var, width=40).pack(fill="x", pady=5)

        ttk.Button(frame, text="Generate CA (Signed by farmhub)", command=self.generate_ca).pack(pady=20)
        
        self.log_text = tk.Text(frame, height=5, state="disabled")
        self.log_text.pack(fill="x")

    def generate_ca(self):
        dev_type = self.type_var.get().strip()
        if not dev_type: return
        
        cmd = f"""
        mkdir -p secrets/{dev_type} && \\
        echo "basicConstraints = critical, CA:TRUE" > v3_ca_tmp.ext && \\
        openssl genrsa -out secrets/{dev_type}/ca.key 4096 && \\
        openssl req -new -key secrets/{dev_type}/ca.key -out secrets/{dev_type}/ca.csr -subj "/C=BD/ST=Dhaka/L=Dhaka/O=DripIrrigation/OU=IoT/CN={dev_type}_CA" && \\
        openssl x509 -req -in secrets/{dev_type}/ca.csr -CA secrets/farmhub/ca.pem -CAkey secrets/farmhub/ca.key -CAcreateserial -out secrets/{dev_type}/ca.pem -days 3650 -sha256 -extfile v3_ca_tmp.ext && \\
        rm v3_ca_tmp.ext
        """
        try:
            subprocess.run(cmd, shell=True, check=True, cwd=os.getcwd())
            self.log_text.config(state="normal")
            self.log_text.insert(tk.END, f"Successfully generated CA for {dev_type}\n")
            self.log_text.config(state="disabled")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to generate CA:\n{e}")


class DashboardWindow(tk.Toplevel):
    def __init__(self, master, api):
        super().__init__(master)
        self.title("OpenRemote Advanced Dashboard")
        self.geometry("400x300")
        self.api = api
        self.setup_ui()
        
        # Hide the main login window
        self.master.withdraw()
        # Show login window again if this is closed
        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def setup_ui(self):
        frame = ttk.Frame(self, padding="20")
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="API Task Dashboard", font=("Arial", 16, "bold")).pack(pady=(0, 20))

        ttk.Button(frame, text="1. Auto-Provisioning CA Manager", command=self.open_ca_manager).pack(fill="x", pady=5)
        ttk.Button(frame, text="2. Asset Template JSON Editor", command=self.open_template_editor).pack(fill="x", pady=5)
        ttk.Button(frame, text="3. Key & Certificate Generator", command=self.open_cert_gen).pack(fill="x", pady=5)
        
    def open_ca_manager(self):
        AutoProvisioningWindow(self, self.api)
        
    def open_template_editor(self):
        AssetTemplateEditorWindow(self, self.api)
        
    def open_cert_gen(self):
        CertGeneratorWindow(self)

    def on_close(self):
        self.master.deiconify()
        self.destroy()

class OpenRemoteLoginApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("OpenRemote Login")
        self.geometry("400x350")
        self.setup_ui()

    def setup_ui(self):
        frame = ttk.Frame(self, padding="20")
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="Manager Login", font=("Arial", 16, "bold")).pack(pady=(0, 20))

        ttk.Label(frame, text="Host:").pack(anchor="w")
        self.host_var = tk.StringVar(value="master.senspanel.com")
        ttk.Entry(frame, textvariable=self.host_var).pack(fill="x", pady=5)

        ttk.Label(frame, text="Realm:").pack(anchor="w")
        self.realm_var = tk.StringVar(value="master")
        ttk.Entry(frame, textvariable=self.realm_var).pack(fill="x", pady=5)

        ttk.Label(frame, text="Username:").pack(anchor="w")
        self.user_var = tk.StringVar(value="admin")
        ttk.Entry(frame, textvariable=self.user_var).pack(fill="x", pady=5)

        ttk.Label(frame, text="Password:").pack(anchor="w")
        self.pass_var = tk.StringVar(value="secret")
        ttk.Entry(frame, textvariable=self.pass_var, show="*").pack(fill="x", pady=5)

        self.login_btn = ttk.Button(frame, text="Login", command=self.do_login)
        self.login_btn.pack(pady=20)

    def do_login(self):
        self.login_btn.config(state="disabled", text="Authenticating...")
        host = self.host_var.get().strip()
        user = self.user_var.get().strip()
        pwd = self.pass_var.get()
        realm = self.realm_var.get().strip()

        api = OpenRemoteAPI(host, user, pwd, realm)
        
        def _auth():
            success, msg = api.authenticate()
            self.after(0, self.on_login_result, success, msg, api)

        threading.Thread(target=_auth, daemon=True).start()

    def on_login_result(self, success, msg, api):
        self.login_btn.config(state="normal", text="Login")
        if success:
            DashboardWindow(self, api)
        else:
            messagebox.showerror("Login Failed", f"Authentication failed:\n{msg}")


if __name__ == "__main__":
    app = OpenRemoteLoginApp()
    app.mainloop()
