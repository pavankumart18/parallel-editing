export const DOCUMENTS = [
    {
        id: "doc_commercial_lease",
        title: "Commercial Lease Agreement",
        description: "Standard commercial lease with liability clauses.",
        icon: "bi-building",
        content: `COMMERCIAL LEASE AGREEMENT

This Commercial Lease Agreement (the "Lease") is made and effective as of [DATE], by and between [LANDLORD_NAME] ("Landlord") and [TENANT_NAME] ("Tenant").

1. PREMISES
Landlord hereby leases to Tenant, and Tenant hereby leases from Landlord, the real property located at [ADDRESS] (the "Premises"). The Premises consists of approximately 5,000 square feet of office space.

2. TERM
The term of this Lease shall be for a period of five (5) years, commencing on [START_DATE] and ending on [END_DATE] (the "Term"). Tenant shall have the option to renew this Lease for one additional term of five (5) years by providing written notice to Landlord at least 180 days prior to the expiration of the initial Term.

3. RENT & SECURITY DEPOSIT
(a) Base Rent. Tenant shall pay to Landlord a base rent of $12,500 per month, payable in advance on the first day of each calendar month.
(b) Security Deposit. Upon execution of this Lease, Tenant shall deposit with Landlord the sum of $25,000 as security for the performance of Tenant's obligations hereunder.

4. USE OF PREMISES
The Premises shall be used solely for general office purposes and for no other use without Landlord's prior written consent. Tenant shall comply with all applicable laws, ordinances, and regulations regarding the use of the Premises.

5. MAINTENANCE AND REPAIRS
(a) Landlord's Obligations. Landlord shall be responsible for the maintenance and repair of the structural portions of the building, including the roof, foundation, and exterior walls.
(b) Tenant's Obligations. Tenant shall be responsible for the maintenance and repair of the interior of the Premises, including all fixtures, equipment, and personal property located therein.

6. INSURANCE AND INDEMNIFICATION
(a) Tenant's Insurance. Tenant shall maintain commercially reasonable liability insurance with limits of not less than $2,000,000 per occurrence.
(b) Indemnification. Tenant agrees to indemnify, defend, and hold harmless Landlord from and against any and all claims, damages, liabilities, and expenses arising out of Tenant's use of the Premises.

7. DEFAULT AND REMEDIES
If Tenant fails to pay rent when due or fails to perform any other obligation under this Lease, Landlord may terminate this Lease and recover possession of the Premises.

8. MISCELLANEOUS
(a) Governing Law. This Lease shall be governed by the laws of the State of [STATE].
(b) Entire Agreement. This Lease constitutes the entire agreement between the parties and supersedes all prior agreements and understandings.

IN WITNESS WHEREOF, the parties have executed this Lease as of the date first above written.

__________________________
Landlord Signature

__________________________
Tenant Signature
`.repeat(10), // Increased to ensure ~3 pages
        prompts: [
            {
                label: "Strengthen Liability Clauses",
                instruction: "Review Section 6 (Insurance and Indemnification). Increase the liability insurance limit to $5,000,000 and add a clause requiring the Tenant to name the Landlord as an additional insured.",
                section: "Section 6"
            },
            {
                label: "Clarify Maintenance Duties",
                instruction: "Expand Section 5 to explicitly state that the Tenant is responsible for HVAC maintenance and replacement if caused by Tenant's negligence.",
                section: "Section 5"
            },
            {
                label: "Adjust Rent Terms",
                instruction: "Modify Section 3 to include an annual rent escalation of 3% occurring on the anniversary of the commencement date.",
                section: "Section 3"
            }
        ]
    },
    {
        id: "doc_tech_policy",
        title: "IT Security & Acceptable Use Policy",
        description: "Enterprise acceptable use policy for employees.",
        icon: "bi-shield-lock",
        content: `IT SECURITY AND ACCEPTABLE USE POLICY

1. OVERVIEW
This policy outlines the acceptable use of computer equipment at [COMPANY_NAME]. These rules are in place to protect the employee and [COMPANY_NAME]. Inappropriate use exposes [COMPANY_NAME] to risks including virus attacks, compromise of network systems and services, and legal issues.

2. SCOPE
This policy applies to the use of information, electronic and computing devices, and network resources to conduct [COMPANY_NAME] business or interact with internal networks and business systems, whether owned or leased by [COMPANY_NAME], the employee, or a third party.

3. GENERAL USE AND OWNERSHIP
(a) Proprietary Information. All data stored on [COMPANY_NAME] systems is the property of [COMPANY_NAME].
(b) Privacy. Employees should have no expectation of privacy in anything they create, store, send, or receive on the company's computer systems.

4. SECURITY AND PROPRIETARY INFORMATION
(a) Passwords. Keep passwords secure and do not share accounts. Authorized users are responsible for the security of their passwords and accounts.
(b) Locking. PC workstations must be secured with a password-protected screensaver with the automatic activation feature set at 10 minutes or less.

5. UNACCEPTABLE USE
The following activities are, in general, prohibited. Employees may be exempted from these restrictions during the course of their legitimate job responsibilities (e.g., systems administration staff may have a need to disable the network access of a host if that host is disrupting production services).
(a) Violating the rights of any person or company protected by copyright, trade secret, patent, or other intellectual property, or similar laws or regulations.
(b) Unauthorized copying of copyrighted material including, but not limited to, digitization and distribution of photographs from magazines, books, or other copyrighted sources, copyrighted music, and the installation of any copyrighted software for which [COMPANY_NAME] or the end user does not have an active license.

6. PERSONAL USAGE
Limited personal use of company resources is permitted provided that it does not interfere with the employee's duties or the operations of the company.

7. ENFORCEMENT
Any employee found to have violated this policy may be subject to disciplinary action, up to and including termination of employment.

8. REVISIONS
[COMPANY_NAME] reserves the right to revise this policy at any time.

`.repeat(12),
        prompts: [
            {
                label: "Harden Password Rules",
                instruction: "Update Section 4 to mandate Multi-Factor Authentication (MFA) for all remote access and change the screensaver lock timeout to 5 minutes.",
                section: "Section 4"
            },
            {
                label: "Clarify Personal Usage",
                instruction: "Rewrite Section 6 to strictly prohibit the use of company resources for any crypto-currency mining or commercial activities outside of company business.",
                section: "Section 6"
            },
            {
                label: "Expand Scope",
                instruction: "Update Section 2 to explicitly include 'Internet of Things (IoT) devices' and 'BYOD (Bring Your Own Device)' mobile phones.",
                section: "Section 2"
            }
        ]
    },
    {
        id: "doc_project_proposal",
        title: "AI Implementation Project Proposal",
        description: "Proposal for integrating GenAI into workflows.",
        icon: "bi-cpu",
        content: `PROJECT PROPOSAL: GENERATIVE AI INTEGRATION

1. EXECUTIVE SUMMARY
The purpose of this project is to integrate Generative AI (GenAI) models into our core customer support platform. By doing so, we aim to reduce response times by 40% and increase customer satisfaction scores (CSAT) by 15 points within Q1 2026.

2. PROBLEM STATEMENT
Current support workflows are manual and labor-intensive. Agents spend approximately 60% of their time searching for information and typing standard responses. This leads to burnout and slow resolution times.

3. PROPOSED SOLUTION
We propose a three-phased approach to integrating GenAI:
Phase 1: Knowledge Base Search Assistant
Phase 2: Automated Draft Responses for Agents
Phase 3: Autonomous Chatbot for Tier 1 Issues

4. TECHNOLOGY STACK
- LLM Provider: OpenAI GPT-4 or Anthropic Claude 3.5
- Orchestration: LangChain / Custom Python Middleware
- Vector Database: Pinecone or Milvus
- Frontend: React.js with WebSocket streaming

5. TIMELINE AND MILESTONES
- Month 1: Requirement Gathering and Architecture Design
- Month 2: Prototype Development (Phase 1)
- Month 3: Pilot Testing with Beta Group
- Month 4: Full Rollout of Phase 1 and Development of Phase 2

6. BUDGET ESTIMATES
- Cloud Infrastructure: $5,000 / month
- API Token Costs: $8,000 / month (estimated based on current volume)
- Development Resources: 3 Full-stack Engineers, 1 AI Specialist

7. RISKS AND MITIGATION
- Risk: Hallucinations / Inaccurate Info via AI.
- Mitigation: Implement strict RAG (Retrieval Augmented Generation) guardrails and human-in-the-loop review for Phase 2.

8. CONCLUSION
Investing in this technology is crucial for maintaining competitive advantage. The ROI is expected to be realized within 8 months of deployment.
`.repeat(10),
        prompts: [
            {
                label: "Refine Budget Section",
                instruction: "In Section 6, break down the 'Development Resources' costs in more detail and add a 10% contingency buffer to the total budget.",
                section: "Section 6"
            },
            {
                label: "Elaborate on Risks",
                instruction: "Expand Section 7 to include data privacy risks (GDPR/CCPA) and propose a mitigation strategy involving data anonymization.",
                section: "Section 7"
            },
            {
                label: "Update Tech Stack",
                instruction: "Change the Vector Database in Section 4 to 'Weaviate' and add 'Redis' for caching frequent queries.",
                section: "Section 4"
            }
        ]
    },
    {
        id: "doc_launch_strategy",
        title: "Product Launch Strategy",
        description: "GTM plan for the new mobile application.",
        icon: "bi-rocket-takeoff",
        content: `PRODUCT LAUNCH STRATEGY: "APEX" MOBILE APP

1. LAUNCH OBJECTIVES
Primary Goal: Achieve 10,000 active users within the first 30 days.
Secondary Goal: Maintain a 4.5-star rating on both App Store and Google Play.

2. TARGET AUDIENCE
- Primary: Gen Z and Millennials aged 18-35 interested in productivity.
- Secondary: Remote workers and digital nomads.

3. MARKETING CHANNELS
(a) Social Media. focus on TikTok and Instagram Reels showing use cases.
(b) Influencer Partnerships. Partner with 5 key productivity influencers.
(c) Email Marketing. Drip campaign to existing newsletter subscribers.

4. PRICING STRATEGY
- Freemium Model: Basic features free, Premium features at $9.99/month.
- Early Bird Offer: 50% discount for the first 1,000 annual subscribers.

5. KEY MESSAGING
"Master your day with Apex. The only productivity tool you need."

6. LAUNCH TIMELINE
- T-4 Weeks: Teaser campaign starts.
- T-2 Weeks: Open beta for waitlist (500 users).
- Launch Day: Global release, press release distribution, launch party live stream.
- T+1 Week: First major update based on user feedback.

7. SUCCESS METRICS (KPIs)
- CAC (Customer Acquisition Cost): Target < $15
- DAU (Daily Active Users): Target 2,000 by Day 7
- Retention Rate: > 40% Week 1 retention

8. RISKS
- Server overload on launch day.
- Negative reviews due to initial bugs.
`.repeat(8),
        prompts: [
            {
                label: "Refine Pricing",
                instruction: "In Section 4, add a 'Team Plan' tier for enterprise users at $49/month per seat.",
                section: "Section 4"
            },
            {
                label: "Expand Social Strategy",
                instruction: "Update Section 3(a) to include LinkedIn Organic posts targeting professionals.",
                section: "Section 3"
            },
            {
                label: "Mitigate Risks",
                instruction: "Add a mitigation plan in Section 8 for 'Server Overload' involving auto-scaling groups and a CDN.",
                section: "Section 8"
            }
        ]
    }
];
