# মাল্টিপল CA সার্টিফিকেট: সমস্যা ও সমাধান

এই রিপোর্ট অনলাইন রিসার্চের প্রমাণের ওপর ভিত্তি করে তৈরি।

---
---

## ১. কেন সার্ভার ক্র্যাশ করেছিল?

আপনি `docker-compose.coolify.yml` ফাইলে `mqtt-ca-cert` ব্লকে **১১টি CA সার্টিফিকেট** একসাথে রেখেছিলেন।

### কারণ: HAProxy-এর মেমোরি ও TLS সীমাবদ্ধতা

- HAProxy **সব CA সার্টিফিকেট মেমোরিতে লোড করে** স্টার্টের সময়।
- বড় CA বান্ডেল হলে **রিলোডের সময় মেমোরি দ্বিগুণ** হয়ে যায়।
- TLS হ্যান্ডশেকের সময় HAProxy ক্লায়েন্টকে **সব CA-এর নাম (DN) পাঠায়**।
- যদি এই নামের তালিকা খুব বড় হয়, তাহলে **TLS স্ট্যান্ডার্ড (RFC 5246) লিমিট** অতিক্রম হতে পারে।
- ফলে সার্ভার **ক্র্যাশ বা হ্যান্ডশেক ফেইল** হয়।

> [!CAUTION]
> **প্রমাণ:** HAProxy-এর GitHub ইস্যু এবং অফিশিয়াল ডকুমেন্টেশন অনুযায়ী,
> বড় `ca-file` বান্ডেল `segmentation fault` বা `excessive message size` এরর তৈরি করতে পারে।
> *(সূত্র: github.com/haproxy, haproxy.org ডকুমেন্টেশন)*

---
---

## ২. আসলে HAProxy-এর `ca-file`-এ কী থাকা উচিত?

### উত্তর: শুধু **একটি** RootCA। বেশি দরকার নেই।

HAProxy-এর `ca-file`-এর কাজ হলো:
- TLS হ্যান্ডশেকের সময় ক্লায়েন্টের সার্টিফিকেট **আসল কি না চেক করা।**
- যদি ক্লায়েন্ট তার পুরো **সার্টিফিকেট চেইন** (device cert + CA cert) পাঠায়, তাহলে HAProxy-এর শুধু **রুট CA** থাকলেই চলে।

### কিন্তু আপনার ১০টি আলাদা CA আছে!

আপনার সিস্টেমে প্রতিটি ডিভাইস ক্যাটাগরির **আলাদা আলাদা CA** আছে:

| ক্যাটাগরি | CA নাম |
|---|---|
| ভালভ | `valve_CA` |
| সেন্সর | `sens_CA` |
| সুইচ | `switch_CA` |
| ফার্মহাব | `farmhub_CA` |
| ... | ... |

এগুলো সব **স্বতন্ত্র (self-signed)** CA — কোনো কমন RootCA নেই।

---
---

## ৩. সবচেয়ে নিরাপদ সমাধান কী?

অনলাইন রিসার্চ অনুযায়ী, **দুটি পদ্ধতি** আছে। দুটোই নিরাপদ:

---

### 🥇 পদ্ধতি ক: হায়ারার্কিক্যাল CA (সর্বোত্তম — Recommended)

**ধারণা:** একটি **মাস্টার RootCA** তৈরি করুন। তারপর এই RootCA দিয়ে প্রতিটি ক্যাটাগরি CA-কে **Intermediate CA** হিসেবে সাইন করুন।

```
🔑 মাস্টার RootCA (একটি মাত্র)
  ├── valve_CA     (Intermediate)
  ├── sens_CA      (Intermediate)
  ├── switch_CA    (Intermediate)
  ├── farmhub_CA   (Intermediate)
  └── ... (বাকি সব)
```

**সুবিধা:**
- HAProxy-এর `ca-file`-এ **শুধু একটি RootCA** রাখলেই হবে।
- সব ক্যাটাগরির ডিভাইস একই RootCA দিয়ে ভেরিফাই হবে।
- সার্ভার ক্র্যাশের ঝুঁকি **শূন্য।**
- ইন্ডাস্ট্রি স্ট্যান্ডার্ড PKI আর্কিটেকচার।

**HAProxy কনফিগ:**
```haproxy
bind *:8883 ssl crt /certs/mqtt-server-combined.pem ca-file /certs/rootCA.pem verify required
```

> [!IMPORTANT]
> **শর্ত:** ডিভাইসকে তার সার্টিফিকেটের সাথে সাথে **Intermediate CA-ও পাঠাতে** হবে
> (যাকে বলে "full chain")। তাহলে HAProxy শুধু RootCA দিয়েই পুরো চেইন ভেরিফাই করতে পারবে।

> [!NOTE]
> **প্রমাণ:** HAProxy ডকুমেন্টেশন এবং IoT সিকিউরিটি বেস্ট প্র্যাক্টিস অনুযায়ী,
> একটি RootCA + একাধিক Intermediate CA হলো **সবচেয়ে স্কেলেবল এবং নিরাপদ** পদ্ধতি।
> *(সূত্র: haproxy.org, stackoverflow.com)*

---

### 🥈 পদ্ধতি খ: OpenRemote Manager-এ একাধিক Provisioning Config (বিকল্প)

**ধারণা:** HAProxy-এ শুধু **একটি CA** রাখুন (যেকোনো একটি, বা RootCA)। তারপর **প্রতিটি ক্যাটাগরির CA** আলাদা আলাদাভাবে **OpenRemote Manager-এর Auto Provisioning কনফিগারেশনে** রেজিস্টার করুন।

**কীভাবে:**
1. OpenRemote Manager UI-তে যান।
2. **Auto Provisioning** সেকশনে যান।
3. প্রতিটি ক্যাটাগরির জন্য **আলাদা X.509 Provisioning Config** তৈরি করুন।
4. প্রতিটিতে সেই ক্যাটাগরির CA সার্টিফিকেট দিন।

| কনফিগ নাম | CA Certificate | Asset Template |
|---|---|---|
| `Valve Devices` | `valve_CA.pem` | `ValveAsset` |
| `Sensor Devices` | `sens_CA.pem` | `SensorAsset` |
| `Switch Devices` | `switch_CA.pem` | `SwitchAsset` |
| ... | ... | ... |

**সুবিধা:**
- HAProxy-এর `ca-file` **ছোট থাকবে।**
- Manager নিজেই সার্টিফিকেট ভেরিফাই করবে।
- **কোনো CA রি-সাইন করার দরকার নেই।**

**সীমাবদ্ধতা:**
- HAProxy লেভেলে mTLS ভেরিফিকেশন শুধু একটি CA-তে সীমাবদ্ধ থাকবে।
- অথবা HAProxy-এ `verify optional` ব্যবহার করতে হবে (কম নিরাপদ)।

> [!NOTE]
> **প্রমাণ:** OpenRemote ডকুমেন্টেশন অনুযায়ী, প্রতিটি Realm-এ **একাধিক Provisioning Config** তৈরি করা যায়,
> প্রতিটিতে আলাদা CA দেওয়া যায়।
> *(সূত্র: openremote.io অফিশিয়াল ডকুমেন্টেশন)*

---
---

## ৪. আপনার HAProxy কনফিগারেশন বিশ্লেষণ

আপনার বর্তমান `haproxy.cfg` (docker-compose-এর শুরুতে):

```haproxy
frontend mqtt
    bind *:8883 ssl crt /certs/mqtt-server-combined.pem ca-file /certs/ca.pem verify required
    mode tcp
    default_backend mqtt_backend
```

### কী ঠিক আছে ✅

| বিষয় | মন্তব্য |
|---|---|
| `ssl crt ...` | সার্ভার সার্টিফিকেট সঠিকভাবে লোড হচ্ছে |
| `ca-file /certs/ca.pem` | CA সার্টিফিকেট দেওয়া আছে |
| `verify required` | mTLS বাধ্যতামূলক — খুব ভালো |
| `mode tcp` | MQTT-এর জন্য সঠিক |

### কী উন্নতি করা যায় 🔧

| বিষয় | সুপারিশ |
|---|---|
| `timeout` | `timeout client 3h` এবং `timeout server 3h` যোগ করুন (MQTT দীর্ঘস্থায়ী কানেকশন) |
| `clitcpka` | `option clitcpka` যোগ করুন (আইডল কানেকশন জিইয়ে রাখতে) |
| TLS ভার্সন | `ssl-min-ver TLSv1.2` যোগ করুন (পুরানো TLS ব্লক করতে) |
| `no-tls-tickets` | সেশন রিজাম্পশন বন্ধ করতে (অতিরিক্ত নিরাপত্তা) |

### উন্নত কনফিগারেশনের উদাহরণ:
```haproxy
frontend mqtt
    bind *:8883 ssl crt /certs/mqtt-server-combined.pem ca-file /certs/ca.pem verify required no-tls-tickets ssl-min-ver TLSv1.2
    mode tcp
    option clitcpka
    timeout client 3h
    timeout server 3h
    default_backend mqtt_backend
```

> [!NOTE]
> **প্রমাণ:** HAProxy MQTT বেস্ট প্র্যাক্টিস এবং OpenRemote-এর প্রক্সি রিপোজিটরি অনুযায়ী,
> `clitcpka` এবং দীর্ঘ টাইমআউট MQTT-এর জন্য অত্যন্ত গুরুত্বপূর্ণ।
> *(সূত্র: github.com/openremote/proxy, haproxy.org)*

---
---

## ৫. সারসংক্ষেপ ও সুপারিশ

| পদ্ধতি | নিরাপত্তা | জটিলতা | ক্র্যাশ ঝুঁকি | সুপারিশ |
|---|---|---|---|---|
| ১১টি CA একসাথে ca-file-এ | 🟡 মাঝারি | কম | 🔴 **উচ্চ** | ❌ |
| হায়ারার্কিক্যাল CA (RootCA → Intermediate) | 🟢 **সর্বোচ্চ** | মাঝারি | 🟢 **শূন্য** | ✅ **সর্বোত্তম** |
| Manager-এ আলাদা Provisioning Config | 🟢 উচ্চ | কম | 🟢 **শূন্য** | ✅ ভালো |

> [!TIP]
> **চূড়ান্ত সুপারিশ:**
> আপনার বর্তমান Self-Signed CA গুলো রি-সাইন করার দরকার নেই।
> **পদ্ধতি খ** (Manager-এ আলাদা Provisioning Config) এখনই ব্যবহার করতে পারবেন কোনো কিছু না বদলে।
> ভবিষ্যতে নতুন ডিভাইস ফ্লিটের জন্য **পদ্ধতি ক** (Hierarchical CA) গ্রহণ করা সবচেয়ে ভালো হবে।

---

> [!NOTE]
> **সূত্র তালিকা (Online Sources):**
> - HAProxy GitHub Issues — `ca-file` মেমোরি ও ক্র্যাশ সমস্যা
> - HAProxy অফিশিয়াল ডকুমেন্টেশন — mTLS, `verify required`, RFC 5246 সীমাবদ্ধতা
> - OpenRemote অফিশিয়াল ডকুমেন্টেশন — X.509 Auto Provisioning, per-realm কনফিগারেশন
> - OpenRemote GitHub Proxy Repo — HAProxy কনফিগারেশন টেমপ্লেট
> - Stack Overflow — Intermediate CA সহ HAProxy IoT বেস্ট প্র্যাক্টিস
