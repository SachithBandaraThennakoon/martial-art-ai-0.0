import { Link } from "react-router";
import { XCEED_COMPANY } from "../data/companyInfo";
import { CATEGORY_ORDER, slugify } from "../data/techniqueCatalog";
import { useCatalog } from "../context/CatalogContext";

export default function Footer() {
  const { catalog } = useCatalog();
  const mainCategories = catalog.length ? catalog.map((category) => category.category) : CATEGORY_ORDER;

  return (
    <footer className="site-footer">
      <div className="site-footer__main">
        <div className="site-footer__brand">
          <Link aria-label="XMartialArt home" className="navbar__brand site-footer__wordmark" to="/">
            <span className="navbar__brand-mark">XMA</span>
            <span>XMartialArt</span>
          </Link>
          <p>AI movement coaching for safer, more focused martial arts practice.</p>
          <div className="site-footer__actions">
            <Link className="btn btn--light btn--small" to="/register">Start training</Link>
            <Link className="site-footer__contact" to="/contact">Talk to our team <span aria-hidden="true">↗</span></Link>
          </div>
        </div>

        <div className="site-footer__links site-footer__links--platform">
          <strong>Platform</strong>
          <Link to="/studio">Studio</Link>
          <Link to="/dashboard/overview">Progress</Link>
          <Link to="/pricing">Plans</Link>
          <Link to="/contact">Contact</Link>
        </div>
        <div className="site-footer__links site-footer__links--explore">
          <strong>Explore</strong>
          <div className="site-footer__explore-grid">
            {mainCategories.map((category) => (
              <Link key={category} to={`/categories/${slugify(category)}`}>{category}</Link>
            ))}
          </div>
        </div>
        <div className="site-footer__links site-footer__links--legal">
          <strong>Legal</strong>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/account/privacy">Privacy &amp; account</Link>
        </div>
        <div className="site-footer__links site-footer__links--company">
          <strong>Built by Xceed</strong>
          <a href={XCEED_COMPANY.website} rel="noreferrer" target="_blank">Website ↗</a>
          <a href={XCEED_COMPANY.linkedin} rel="noreferrer" target="_blank">LinkedIn ↗</a>
          <a href={`mailto:${XCEED_COMPANY.email}`}>Contact Xceed</a>
        </div>
      </div>
      <div className="site-footer__bottom">
        <span>© {new Date().getFullYear()} XMartialArt</span>
        <span className="site-footer__signature">
          <i aria-hidden="true" /> Developed by&nbsp;
          <a href={XCEED_COMPANY.website} rel="noreferrer" target="_blank">Xceed</a>
        </span>
      </div>
    </footer>
  );
}
