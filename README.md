# STore Automation

## Salon Marketing & Business Automation Platform

STore Automation is a mobile-first Progressive Web App (PWA) designed to help salons and local businesses automate their marketing, customer engagement, reviews, leads, bookings, and business operations.

The platform is being developed around a **Universal Business Architecture** so that the same application can support multiple businesses, users, locations, and external integrations without creating separate application logic for every salon.

---

# Table of Contents

1. [Product Overview](#1-product-overview)
2. [Product Vision](#2-product-vision)
3. [Business Problem](#3-business-problem)
4. [Current Application](#4-current-application)
5. [Architecture Overview](#5-architecture-overview)
6. [Universal Business Architecture](#6-universal-business-architecture)
7. [Multi-Tenant Model](#7-multi-tenant-model)
8. [Authentication](#8-authentication)
9. [User Roles](#9-user-roles)
10. [Supabase](#10-supabase)
11. [Frontend Architecture](#11-frontend-architecture)
12. [API Architecture](#12-api-architecture)
13. [Google Business Profile Integration](#13-google-business-profile-integration)
14. [Google OAuth Flow](#14-google-oauth-flow)
15. [Google Callback](#15-google-callback)
16. [Google Account Discovery](#16-google-account-discovery)
17. [Google Location Discovery](#17-google-location-discovery)
18. [Exact Place ID Matching](#18-exact-place-id-matching)
19. [Google Connection Lifecycle](#19-google-connection-lifecycle)
20. [Session Restoration](#20-session-restoration)
21. [Business and Location Mapping](#21-business-and-location-mapping)
22. [Marketing Automation](#22-marketing-automation)
23. [Google Review Assistant](#23-google-review-assistant)
24. [Leads](#24-leads)
25. [Bookings](#25-bookings)
26. [Meta Integration](#26-meta-integration)
27. [WhatsApp Integration](#27-whatsapp-integration)
28. [AI Automation](#28-ai-automation)
29. [Analytics](#29-analytics)
30. [Revenue Attribution](#30-revenue-attribution)
31. [Security](#31-security)
32. [Environment Configuration](#32-environment-configuration)
33. [Deployment](#33-deployment)
34. [Git Workflow](#34-git-workflow)
35. [Validation and Testing](#35-validation-and-testing)
36. [Production Verification](#36-production-verification)
37. [Troubleshooting History](#37-troubleshooting-history)
38. [Current Development Status](#38-current-development-status)
39. [Known Limitations](#39-known-limitations)
40. [Development Roadmap](#40-development-roadmap)
41. [Architecture Principles](#41-architecture-principles)
42. [Current Milestone](#42-current-milestone)

---

# 1. Product Overview

STore Automation is intended to become a centralized automation platform for salons and local businesses.

The platform combines:

- Business management
- Marketing automation
- Google Business Profile
- Reviews
- Social media
- WhatsApp
- Leads
- Bookings
- AI-generated content
- Analytics
- Revenue attribution

The long-term objective is to reduce the amount of manual work required by a business owner to maintain their digital presence and generate customer activity.

---

# 2. Product Vision

The long-term STore Automation architecture is:

```text
                         STore Automation
                                |
              +-----------------+-----------------+
              |                 |                 |
           Business          Users            Locations
              |
      +-------+-------+-------+-------+
      |       |       |       |       |
    Google   Meta  WhatsApp Reviews Bookings
      |
   Marketing
      |
      AI
      |
   Analytics
      |
   Revenue