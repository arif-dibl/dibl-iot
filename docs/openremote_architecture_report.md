# OpenRemote & Coolify Architecture Report

This report explains why certificates are in the `docker-compose.yml` file, and why the Manager does not need the certificates.

The design of this report is meant to be **easy to read** and **dyslexia friendly**. 

---

## 1. Why use `docker-compose.yml` for certificates?

You are using **Coolify**. Coolify is a tool that deploys applications automatically.

- **Infrastructure as Code:** Coolify reads everything from one file (the `docker-compose.yml`).
- **No manual uploads:** You do not need to manually transfer `.pem` or `.crt` files to the server.
- **Docker Configs:** Coolify uses a feature called `configs`. It takes the text inside your compose file and creates secure files inside the containers.
- **Easy backups:** Everything is in one place. If your server crashes, you only need this one file to rebuild it.

---

## 2. Why the Manager does NOT need the certificates

OpenRemote has a very smart and secure design. It splits the work into two different layers.

### Layer A: The Proxy (HAProxy)
- This is the **front door**.
- It is the only part that talks to the outside internet.
- **Server Certificate:** It uses this to prove to devices that it is the real server (`master.senspanel.com`).
- **CA Certificate:** It uses this to check the device's certificate (mTLS). If the device is fake, the proxy blocks it.

### Layer B: The Manager
- This is the **brain** inside the house. 
- It never touches the outside internet directly.
- It **does not need** the CA Certificate.

### How they work together:
1. The device knocks on the door (Proxy).
2. The Proxy checks the device's ID using the CA Certificate.
3. The Proxy says, "This device is real. Its name is **db01**."
4. The Proxy passes the message to the Manager. 
5. The Manager receives the message. It trusts the Proxy completely, so it just auto-provisions **db01**.

> [!NOTE]
> **Online Verification:** 
> Research confirms this is standard practice. HAProxy handles **TLS Termination** and **Cryptographic Verification**. It then uses HTTP headers to pass the `Subject DN` (the device name) to the backend Manager. This keeps the Manager fast and secure.
